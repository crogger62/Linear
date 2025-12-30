#!/usr/bin/env python3
"""
Domain-agnostic customer-feedback clustering & summarization.

USAGE
-----
python analyze_feedback.py requests.csv
# Optional flags:
#   --k 5                # force number of clusters
#   --max-clusters 8     # cap auto-selected clusters (default 8)
#   --min-clusters 2     # floor for auto-selected clusters (default 2)
#   --samples 3          # examples per cluster in outputs (default 3)

OUTPUTS
-------
- pain_point_summary.csv : Cluster, Count, Example_1..N
- insights.md            : Human-readable cluster summaries + nuance/intent
- Console printout       : Ranked cluster counts and quick takeaways
"""

import os
import re
import sys
import math
import argparse
import json
import warnings
from html import escape
from typing import List, Tuple, Optional

import numpy as np
import pandas as pd
from sklearn.cluster import KMeans
from sklearn.metrics import silhouette_score
from sklearn.feature_extraction.text import TfidfVectorizer

# Suppress sklearn numerical warnings that occur with edge-case data
warnings.filterwarnings("ignore", category=RuntimeWarning, module="sklearn")

# Module-level debug flag and simple printer so summarize_cluster_llm can print the prompt
DEBUG = False
def dbg_print(*a, **kw):
    if DEBUG:
        print(*a, **kw)

# ---------- Optional OpenAI client (used if OPENAI_API_KEY is set) ----------
OPENAI_KEY = os.getenv("OPENAI_API_KEY")
_openai_client = None
if OPENAI_KEY:
    try:
        from openai import OpenAI  # openai>=1.0
        _openai_client = OpenAI()
    except Exception as e:
        print(f"[warn] OPENAI_API_KEY is set, but OpenAI client could not be initialized: {e}")
        _openai_client = None


# ------------------------------ CSV LOADER ----------------------------------
def load_texts(csv_path: str) -> Tuple[pd.DataFrame, List[str], List[str], List[float], List[float], str]:
    """
    Robust loader that:
      - infers delimiter
      - normalizes headers
      - drops Excel 'Unnamed' columns
      - prefers 'request' column if present, otherwise falls back to 'text' or other text-like columns
    """
    df = pd.read_csv(csv_path, sep=None, engine="python")

    # Normalize column names
    df.columns = [str(c).strip().lower() for c in df.columns]

    # Drop unnamed index columns like 'Unnamed: 0'
    df = df.loc[:, [c for c in df.columns if not re.match(r"^unnamed:?\s*\d*$", c)]]

    # ✅ Preferred column priority:
    if "request" in df.columns:
        col = "request"
    elif "text" in df.columns:
        col = "text"
    else:
        # Common fallback synonyms
        candidates = [
            "customer request", "feedback", "comment", "description", 
            "body", "message", "notes", "issue", "content"
        ]
        col = next((c for c in df.columns if c in candidates), None)

        if col is None:
            # Auto-detect most text-like column based on length, non-null %, and column name clues
            def score_series(s: pd.Series):
                nonnull = s.dropna().astype(str)
                avg_len = nonnull.map(len).mean() if len(nonnull) else 0.0
                frac_nonnull = len(nonnull) / max(len(s), 1)
                name_bonus = 5.0 if re.search(r"request|text|feedback|comment|desc|message|notes|issue|content", s.name or "") else 0.0
                return frac_nonnull * 10.0 + (avg_len / 50.0) + name_bonus

            col = max(df.columns, key=lambda c: score_series(df[c]))

    # Extract cleaned values and keep their original indices so we can align other columns
    cleaned = (
        df[col]
        .astype(str)
        .map(lambda s: s.strip())
        .replace({"": pd.NA})
    )
    cleaned = cleaned.dropna()
    # Preserve the full original rows for the cleaned indices so downstream code can access all CSV fields
    df_clean = df.loc[cleaned.index].copy()
    for numeric_col in ("customer_revenue", "customer_size"):
        if numeric_col in df_clean.columns:
            df_clean[numeric_col] = pd.to_numeric(df_clean[numeric_col], errors="coerce").fillna(0)
        else:
            df_clean[numeric_col] = 0
    texts = cleaned.tolist()

    # Extract priority column values aligned to the cleaned rows if present
    if "priority" in df.columns:
        # take values corresponding to the cleaned rows
        pr_series = df.loc[cleaned.index, "priority"].astype(str).map(lambda s: s.strip())
        priorities = pr_series.tolist()
    else:
        priorities = ["" for _ in texts]

    if not texts:
        raise ValueError(f"No non-empty rows found in column '{col}'.")

    revenues = df_clean["customer_revenue"].astype(float).tolist()
    sizes = df_clean["customer_size"].astype(float).tolist()

    return df_clean, texts, priorities, revenues, sizes, col


# --------------------------- TEXT PREPROCESSING ------------------------------
def preprocess_texts(texts: List[str]) -> List[str]:
    """
    Lightweight normalization that is domain-agnostic.
    (We avoid heavy lemmatization to keep deps minimal.)
    """
    normd = []
    for t in texts:
        s = t.lower().strip()
        s = re.sub(r"\s+", " ", s)
        normd.append(s)
    return normd


# ---------------------------- VECTORIZATIONS --------------------------------
def embed_texts_openai(texts: List[str]) -> np.ndarray:
    """
    Uses OpenAI embeddings if client available; raises if not.
    """
    if _openai_client is None:
        raise RuntimeError("OpenAI client not available.")
    # text-embedding-3-small is cost-effective & good for clustering
    model = "text-embedding-3-small"
    # Batch for efficiency
    resp = _openai_client.embeddings.create(model=model, input=texts)
    vectors = [d.embedding for d in resp.data]
    return np.array(vectors, dtype=np.float32)


def vectorize_texts_tfidf(texts: List[str]) -> np.ndarray:
    """
    TF-IDF fallback when OpenAI isn't available.
    """
    # Filter out empty texts
    non_empty = [t for t in texts if t and t.strip()]
    if not non_empty:
        raise ValueError("No non-empty texts to vectorize.")
    if len(non_empty) < len(texts):
        print(f"[warn] Filtered out {len(texts) - len(non_empty)} empty texts before vectorization.")
    
    # Try with default parameters first
    try:
        vec = TfidfVectorizer(
            ngram_range=(1, 2),
            min_df=1,
            max_df=0.95,
            strip_accents="unicode"
        )
        X = vec.fit_transform(non_empty)
    except ValueError as e:
        if "no terms remain" in str(e):
            # If all terms filtered out, try more lenient parameters
            print(f"[warn] Default TF-IDF parameters filtered all terms. Trying more lenient settings...")
            vec = TfidfVectorizer(
                ngram_range=(1, 2),
                min_df=1,
                max_df=0.99,  # More lenient: allow terms that appear in up to 99% of docs
                strip_accents="unicode"
            )
            try:
                X = vec.fit_transform(non_empty)
            except ValueError:
                # Last resort: remove max_df entirely and use only min_df
                print(f"[warn] Still filtering all terms. Using most lenient settings...")
                vec = TfidfVectorizer(
                    ngram_range=(1, 2),
                    min_df=1,
                    strip_accents="unicode"
                )
                X = vec.fit_transform(non_empty)
        else:
            raise
    
    # Convert to dense array and clean any NaN/inf values
    X_dense = X.toarray()
    
    # Replace NaN and inf with 0 to prevent numerical issues in clustering
    if np.any(~np.isfinite(X_dense)):
        nan_count = np.sum(~np.isfinite(X_dense))
        print(f"[warn] Found {nan_count} non-finite values in TF-IDF matrix, replacing with 0")
        X_dense = np.nan_to_num(X_dense, nan=0.0, posinf=0.0, neginf=0.0)
    
    # Ensure no negative values (shouldn't happen with TF-IDF, but be safe)
    X_dense = np.maximum(X_dense, 0.0)
    
    return X_dense


# ------------------------------ CLUSTERING ----------------------------------
def choose_k_auto(X: np.ndarray, k_min: int, k_max: int) -> int:
    """
    Auto-select K using silhouette score within [k_min, k_max].
    Requires >= (k_max) samples; otherwise clamps to feasible range.
    """
    # Validate and clean input matrix
    if np.any(~np.isfinite(X)):
        X = np.nan_to_num(X, nan=0.0, posinf=0.0, neginf=0.0)
    
    n = X.shape[0]
    k_max_eff = max(k_min, min(k_max, n - 1))  # silhouette needs at least k < n
    best_k, best_score = k_min, -1.0
    for k in range(k_min, k_max_eff + 1):
        try:
            with warnings.catch_warnings():
                warnings.simplefilter("ignore", RuntimeWarning)
                km = KMeans(n_clusters=k, n_init="auto", random_state=42).fit(X)
                labels = km.labels_
                # Silhouette score is undefined for 1 cluster or when any cluster has 1 sample
                if len(set(labels)) < 2 or any((labels == c).sum() <= 1 for c in set(labels)):
                    continue
                score = silhouette_score(X, labels, metric="euclidean")
                if score > best_score:
                    best_k, best_score = k, score
        except Exception:
            # On any numerical issues, skip
            continue
    return max(k_min, best_k)


def compute_weights(priorities: List[str], revenues: List[float], sizes: List[float]) -> Optional[np.ndarray]:
    """
    Compute sample weights from priority plus customer metadata.

    Policy:
      - Start from priority weight (5 for high/urgent signals, otherwise 1)
      - Scale by log1p of customer revenue and size so large accounts get extra emphasis

    Returns an array of floats (same length as priorities) or None if weights remain uniform.
    """
    if not priorities:
        return None

    weights: List[float] = []
    revenue_len = len(revenues)
    size_len = len(sizes)
    priority_tokens = {"1", "high", "priority", "p", "urgent", "true", "Important", "important"}

    for idx, p in enumerate(priorities):
        p_low = (p or "").strip().lower()
        base = 5.0 if p_low in priority_tokens else 1.0

        revenue = revenues[idx] if idx < revenue_len else 0.0
        size = sizes[idx] if idx < size_len else 0.0

        raw_revenue_factor = 1.0 + math.log1p(max(revenue, 0.0))
        revenue_factor = math.log(max(raw_revenue_factor, 1e-9)) if raw_revenue_factor > 0 else 0.0
        size_factor = 1.0 + math.log1p(max(size, 0.0))

        weight = base * revenue_factor * size_factor
        weights.append(weight)

    arr = np.array(weights, dtype=float)
    if arr.size == 0 or np.allclose(arr, arr[0]):
        return None
    return arr


def cluster_texts(X: np.ndarray, k: int, sample_weight: Optional[np.ndarray] = None) -> Tuple[np.ndarray, KMeans]:
    # Validate and clean input matrix
    if np.any(~np.isfinite(X)):
        X = np.nan_to_num(X, nan=0.0, posinf=0.0, neginf=0.0)
    
    with warnings.catch_warnings():
        warnings.simplefilter("ignore", RuntimeWarning)
        km = KMeans(n_clusters=k, n_init="auto", random_state=42)
        if sample_weight is not None:
            km.fit(X, sample_weight=sample_weight)
        else:
            km.fit(X)
    return km.labels_, km


# ---------------------------- SUMMARIZATION ---------------------------------
def summarize_cluster_llm(texts: List[str]) -> Tuple[str, str, str]:
    """
    Use an LLM to generate a (title, summary, representative) triple. Returns empty strings if unavailable.
    representative should be one exact request from the provided texts.
    """
    if _openai_client is None:
        return "", "", ""
    # Join all provided lines (one per request) into the prompt; do not silently cap them here
    joined = "\n".join(f"- {t}" for t in texts)
    dbg_print(f"[debug] Preparing LLM summary for {len(texts)} texts.\n"+joined)

    # Prefer a user-editable prompt template file; fallback to the inline prompt when not present
    template = None
    p = None
    try:
        from pathlib import Path
        p = Path(__file__).parent / "analysis.prompt"
        if p.exists():
            template = p.read_text(encoding="utf-8")
    except Exception:
        template = None

    if template:
        if "{joined}" in template:
            base_prompt = template.format(joined=joined)
            dbg_print("[debug] analysis.prompt contains {joined}; used template with substitution.")
        else:
            base_prompt = template.rstrip() + "\n\nSample requests:\n" + joined
            dbg_print("[debug] analysis.prompt missing {joined}; appended Sample requests block.")
    else:
        dbg_print("[debug] Analysis prompt file not found; using inline prompt.")
        base_prompt = (
            "You are helping a company synthesize customer feedback.\n"
            "Given the sample requests below, write 2–4 sentences that:\n"
            " \u2022 Explain the core concept that ties these elements together conceptually.\n"
            " \u2022 Name the core pain point in plain language.\n"
            "These may arise from any industry, not just software.\n"
            "Be concise and non-marketing.\n\n"
            f"Sample requests:\n{joined}\n"
        )

        # Ask the model to return JSON with title, summary, and a single most-representative request
    prompt = (
        base_prompt
                + "\n\nPlease also pick one exact request from the samples that best represents the cluster."
                + "\n\nOutput format (JSON): "
                    '{"title": "<short title (max 8 words)>", '
                    '"summary": "<2-4 sentence summary>", '
                    '"representative": "<paste one exact line from the sample requests>"}'
    )

    if p is not None:
        dbg_print("[debug] Attempting to load analysis prompt from:", str(p))
    dbg_print("[debug] LLM prompt:\n" + prompt)
    dbg_print("[debug] LLM request sent")

    try:
        resp = _openai_client.chat.completions.create(
            model="gpt-4o-mini",
            messages=[
                {"role": "system", "content": "Be precise, concise, and analytical."},
                {"role": "user", "content": prompt},
            ],
            temperature=0.2,
        )
        raw = resp.choices[0].message.content or ""
        return _parse_llm_title_summary(str(raw))
    except Exception as e:
        dbg_print(f"[debug] LLM error: {e}")
        return "", "", ""


def heuristic_summary(texts: List[str], top_terms: List[str]) -> str:
    """
    Lightweight fallback summary if LLM is not available.
    """
    # Simple cues for intent/nuance (domain-agnostic)
    s_join = " ".join(texts).lower()
    intents = []
    if re.search(r"\b(bug|error|crash|broken|fail|doesn'?t work|not working)\b", s_join):
        intents.append("Bug")
    if re.search(r"\bfeature|add|support|enable|would like|can you\b", s_join):
        intents.append("Feature Request")
    if re.search(r"\bconfus|how do i|unclear|documentation|docs|help\b", s_join):
        intents.append("Documentation/Clarity")
    if re.search(r"\bslow|lag|performance|optimiz|fast|speed\b", s_join):
        intents.append("Performance/Quality")
    if re.search(r"\bsetting|option|configure|preference|custom\b", s_join):
        intents.append("Configuration/Usability")

    intents = list(dict.fromkeys(intents))  # de-dup preserve order
    key_terms = ", ".join(top_terms[:6]) if top_terms else "n/a"

    return (
        f"Likely theme around: {key_terms}. "
        f"Representative feedback suggests a common pain that could map to intent(s): {', '.join(intents) or 'Unspecified'}. "
        f"Customers express {('frustration' if 'bug' in s_join or 'not working' in s_join else 'a desire for capability/clarity')}."
    )


# ------------------------------- UTILITIES ----------------------------------
def default_title_from_terms(terms: List[str]) -> str:
    """Derive a short title from top terms if LLM title is unavailable."""
    top = [t for t in terms][:3]
    return ("Theme: " + ", ".join(top)) if top else "Theme"


def _parse_llm_title_summary(text: str) -> Tuple[str, str, str]:
    """Parse a JSON object with {"title", "summary", "representative"} from LLM text; fallback to first-line title."""
    if not text:
        return "", "", ""
    # Try to parse JSON object anywhere in the response
    try:
        start = text.find("{")
        end = text.rfind("}")
        if start != -1 and end != -1 and end > start:
            obj = json.loads(text[start:end + 1])
            title = str(obj.get("title", "")).strip()
            summary = str(obj.get("summary", "")).strip()
            representative = str(obj.get("representative", "")).strip()
            if title or summary or representative:
                return title, summary, representative
    except Exception:
        pass
    # Fallback: first non-empty line is title, rest is summary
    lines = [ln.strip() for ln in str(text).splitlines() if ln and ln.strip()]
    if not lines:
        return "", "", ""
    title = lines[0].rstrip(":")
    summary = "\n".join(lines[1:]).strip()
    return title, summary, ""
def top_terms_for_cluster(texts: List[str], all_texts: List[str], n_terms: int = 8) -> List[str]:
    """
    Compute top distinguishing terms for a cluster via TF-IDF against the whole corpus.
    """
    # Filter empty texts
    all_texts_clean = [t for t in all_texts if t and t.strip()]
    texts_clean = [t for t in texts if t and t.strip()]
    
    if not all_texts_clean or not texts_clean:
        return []
    
    # Use more lenient parameters to avoid filtering all terms
    vec = TfidfVectorizer(
        ngram_range=(1, 2),
        min_df=1,
        max_df=0.99,  # More lenient than 0.95
        strip_accents="unicode"
    )
    try:
        # Fit on all texts; transform cluster texts
        vec.fit(all_texts_clean)
        Xc = vec.transform(texts_clean)
        # Average TF-IDF for this cluster
        mean_scores = np.asarray(Xc.mean(axis=0)).ravel()
        terms = np.array(vec.get_feature_names_out())
        idx = mean_scores.argsort()[::-1]
        return terms[idx][:n_terms].tolist()
    except ValueError:
        # Fallback: try without max_df if still filtering all terms
        vec = TfidfVectorizer(
            ngram_range=(1, 2),
            min_df=1,
            strip_accents="unicode"
        )
        vec.fit(all_texts_clean)
        Xc = vec.transform(texts_clean)
        mean_scores = np.asarray(Xc.mean(axis=0)).ravel()
        terms = np.array(vec.get_feature_names_out())
        idx = mean_scores.argsort()[::-1]
        return terms[idx][:n_terms].tolist()


def pick_examples(texts: List[str], k: int) -> List[str]:
    """
    Choose up to k representative examples (first k after sorting by length for variety).
    """
    texts_sorted = sorted(set(texts), key=lambda s: (len(s), s))  # de-dup
    return texts_sorted[:k]


def detect_customer_column(df: pd.DataFrame) -> Optional[str]:
    """Return a candidate customer/name column from the dataframe, or None."""
    candidates = [
        "customer", "customer_name", "name", "user", "requester", "email", "account",
    ]
    for c in df.columns:
        if c.lower() in candidates:
            return c
    # try fuzzy contains
    for c in df.columns:
        if re.search(r"customer|name|user|requester|account|email", str(c).lower()):
            return c
    return None


def format_example(row: dict, text_col: str) -> str:
    """Format a full-row dict into '<customer>:<text>' for outputs. Falls back to text only."""
    customer_col = None
    # prefer explicit keys if present
    for k in ("customer", "customer_name", "name", "user", "requester", "account", "email"):
        if k in row and row[k] and str(row[k]).strip():
            customer_col = k
            break
    if customer_col is None:
        # try any plausible key
        for k in row.keys():
            if re.search(r"customer|name|user|requester|account|email", str(k).lower()):
                customer_col = k
                break

    customer = str(row.get(customer_col, "")).strip() if customer_col else ""
    text = str(row.get(text_col, "")).strip()
    if customer:
        return f"{customer}: {text}"
    return text


# --------------------------------- MAIN -------------------------------------
def main():
    ap = argparse.ArgumentParser(description="Cluster & summarize customer requests.")
    ap.add_argument("csv_path", help="Path to CSV of requests (any text column).")
    ap.add_argument("--k", type=int, default=None, help="Force number of clusters.")
    ap.add_argument("--max-clusters", type=int, default=8, help="Upper bound for auto K.")
    ap.add_argument("--min-clusters", type=int, default=2, help="Lower bound for auto K.")
    ap.add_argument("--samples", type=int, default=3, help="Examples per cluster in outputs.")
    ap.add_argument("--debug", "-d", action="store_true", help="Enable debug printing")
    args = ap.parse_args()

    # Simple debug helper: use dbg(...) to conditionally print when --debug passed
    global DEBUG
    DEBUG = bool(args.debug)
    def dbg(*a, **kw):
        if DEBUG:
            print(*a, **kw)

    # Load & normalize (preserve full rows)
    df_clean, texts_raw, priorities, revenues, customer_sizes, text_col = load_texts(args.csv_path)
    texts = preprocess_texts(texts_raw)

    if len(texts) < 2:
        print("Need at least 2 rows of text to cluster.")
        sys.exit(1)

    # Vectorize: prefer embeddings if OpenAI available, else TF-IDF
    if _openai_client:
        try:
            X = embed_texts_openai(texts)
            vec_mode = "embeddings"
        except Exception as e:
            print(f"[warn] Embeddings failed, falling back to TF-IDF: {e}")
            X = vectorize_texts_tfidf(texts)
            vec_mode = "tfidf"
    else:
        X = vectorize_texts_tfidf(texts)
        vec_mode = "tfidf"

    dbg(f"[info] Vectorization mode: {vec_mode}")
    try:
        dbg("[debug] texts sample (first 20):")
        for i, t in enumerate(texts[:20]):
            dbg(f"[debug]   [{i}]: {t}")
    except Exception:
        dbg("[debug] texts sample unavailable")

    # Choose K
    # Compute sample weights from priorities
    sample_weight = compute_weights(priorities, revenues, customer_sizes)

    if args.k:
        k = max(1, min(args.k, len(texts) - 1))
    else:
        # For now, choose_k_auto ignores sample_weight (silhouette_score doesn't accept weights).
        # We keep the compute_weights call separate so it's easy to adapt later.
        # auto-pick k
        k = choose_k_auto(X, args.min_clusters, args.max_clusters)
        # CHANGED: ensure k is at least 4 (use the max of auto-picked k or 4)
        k = max(k, 4)
        # Clamp k to be less than number of samples (KMeans requires n_samples > n_clusters)
        k = min(k, max(1, len(texts) - 1))
        # As a last resort if silhouette failed everywhere:
        if not (args.min_clusters <= k <= args.max_clusters):
            k = min(max(args.min_clusters, 2), max(2, min(args.max_clusters, len(texts) - 1)))

    # Cluster (deferred to debug section below so we can optionally inspect inputs)
    # Cluster
    dbg(f"[debug] clustering inputs: X.shape={X.shape}, k={k}")
    try:
        dbg(f"[debug] X sample (first 3 rows):\n{X[:3]}")
    except Exception:
        pass

    labels, km = cluster_texts(X, k, sample_weight=sample_weight)

    dbg(f"[debug] clustering outputs: labels.shape={labels.shape}")
    try:
        dbg(f"[debug] labels sample (first 30): {labels[:30].tolist() if hasattr(labels, 'tolist') else labels[:30]}")
    except Exception:
        dbg(f"[debug] labels: {labels}")
    dbg(f"[debug] km object: {km}")
    dbg(f"[debug] km inertia: {getattr(km, 'inertia_', 'n/a')}, centers shape: {getattr(km, 'cluster_centers_', None).shape if getattr(km, 'cluster_centers_', None) is not None else 'n/a'}")
# ...existing code...
    # Group texts by cluster (carry full row dicts forward)
    clusters = []
    for ci in range(k):
        idxs = np.where(labels == ci)[0]
        items = [texts_raw[i] for i in idxs]  # short human-readable examples
        items_rows = df_clean.iloc[idxs].to_dict(orient="records")  # full row dicts for API usage
        clusters.append((ci, items, items_rows))

    # Rank by cluster size (desc)
    clusters.sort(key=lambda tpl: len(tpl[1]), reverse=True)

    # Summarize clusters
    summaries = []
    for ci, items, items_rows in clusters:
        terms = top_terms_for_cluster([t.lower() for t in items], [t.lower() for t in texts_raw])

        # Build formatted examples for output (with customer names)
        # Use the preserved full rows (items_rows) to ensure we include every request
        # and preserve the cluster ordering. This avoids brittle text->row matching.
        examples_fmt = []
        for row in items_rows:
            try:
                examples_fmt.append(format_example(row, text_col))
            except Exception:
                # Fallback: include the raw text if formatting fails
                examples_fmt.append(str(row.get(text_col, "")).strip())

        # For the LLM prompt, use only the raw request texts (not customer names)
        llm_request_texts = [r.get(text_col, "") for r in items_rows]

        title = ""
        summary = ""
        representative = ""
        if _openai_client and vec_mode == "embeddings":
            try:
                title, summary, representative = summarize_cluster_llm(llm_request_texts)
            except Exception:
                title, summary, representative = "", "", ""
        if not summary:
            summary = heuristic_summary(items, terms)
        if not title:
            title = default_title_from_terms(terms)
        if not representative:
            # Heuristic fallback: pick a short, common example from the cluster raw texts
            try:
                representative = pick_examples(items, 1)[0]
            except Exception:
                representative = items[0] if items else ""

        dbg(f"[debug] Cluster {ci} - items_count={len(items)}")
        for i, it in enumerate(items[:10]):  # limit output to first 10 items
            dbg(f"[debug]   item[{i}]: {it}")
        dbg(f"[debug] Cluster {ci} - top terms: {', '.join(terms)}")
        dbg(f"[debug] Cluster {ci} - summary: {summary}")

        # Keep examples, title and summary; full-row data is available in items_rows for downstream API interactions
        summaries.append((ci, len(items), terms, examples_fmt, summary, items_rows, title, representative))

    # Debug: print summary/row counts so we can trace missing entries
    dbg(f"[debug] Preparing to write {len(summaries)} summaries to outputs")
    for ci, count, terms, exs, summary, rows, title, representative in summaries:
        dbg(f"[debug] cluster {ci}: count={count}, exs_len={len(exs)}, rows_len={len(rows)}")
        for i, row in enumerate(rows[:5]):
            dbg(f"[debug]   sample row[{i}] text: {str(row.get(text_col, ''))[:200]}")

    # -------- Console Output --------
    dbg("\n=== Top Pain-Point Clusters ===")
    for ci, count, terms, exs, summary, rows, title, representative in summaries:
        dbg(f"[Cluster {ci}] count={count}  key_terms={', '.join(terms[:6])}")
        dbg(f"  title: {title}")
        if representative:
            dbg(f"  representative: {representative}")
        # Print all preserved rows for visibility
        for row in rows:
            dbg(f"  - {format_example(row, text_col)}")
        dbg(f"  summary: {summary}\n")

    # -------- CSV Output --------
    # pain_point_summary.csv with examples per row
    # exs is at index 3 in our tuple structure
    max_examples = max((len(t[3]) for t in summaries), default=args.samples)
    cols = ["Cluster", "Count"] + [f"Example_{i+1}" for i in range(max_examples)]
    rows = []
    for ci, count, _terms, exs, _summary, _rows, _title, _rep in summaries:
        row = [ci, count] + exs + [""] * (max_examples - len(exs))
        rows.append(row)
    pd.DataFrame(rows, columns=cols).to_csv("pain_point_summary.csv", index=False)

    # -------- Markdown Output --------
    md_lines = ["# Pain Points Summary\n"]
    md_lines.append(f"_Vectorization: {vec_mode}; clusters: {k}_\n")
    for idx, (ci, count, terms, exs, summary, rows, title, representative) in enumerate(summaries, start=1):
        md_lines.append(f"## Cluster {idx} ({count})")
        if title:
            md_lines.append(f"**{title}**")
        if representative:
            md_lines.append(f"_Representative:_ {representative}")
        #md_lines.append(f"**Key terms:** {', '.join(terms)}")
        md_lines.append("")
        # Use the preserved full rows to list examples so we include every request
        if rows:
            md_lines.append("**Examples:**")
            for row in rows:
                try:
                    md_lines.append(f"- {format_example(row, text_col)}")
                except Exception:
                    md_lines.append(f"- {str(row.get(text_col, '')).strip()}")
            md_lines.append("")
        md_lines.append("**Summary:**")
        md_lines.append(summary if summary else "(no summary)")
        md_lines.append("")
    with open("insights.md", "w", encoding="utf-8") as f:
        f.write("\n".join(md_lines))

    # -------- HTML Output --------
    html_lines = [
        "<!DOCTYPE html>",
        "<html lang=\"en\">",
        "<head>",
        "  <meta charset=\"utf-8\" />",
        "  <title>ACME Pain Points Summary</title>",
    "  <style>body{font-family:Arial,Helvetica,sans-serif;margin:2rem;background:#f7f7f9;color:#1a1a1a;}h1{margin-bottom:0.5rem;}section{background:#fff;border-radius:8px;padding:1.25rem;margin-bottom:1.5rem;box-shadow:0 2px 6px rgba(0,0,0,0.06);}section h2{margin-top:0;color:#0f4c81;}section .meta{color:#555;font-size:0.9rem;margin-bottom:0.75rem;}section ul{margin:0 0 1rem 1.25rem;padding:0;}section li{margin-bottom:0.5rem;}section .title{font-weight:600;}section .summary{font-weight:600;} .blue{color:#0f4c81;} hr.sep{border:0;border-top:1px solid #dcdcdc;margin:1rem 0 1.25rem;} footer{margin-top:2rem;font-size:0.85rem;color:#555;}</style>",
        "</head>",
        "<body>",
        "  <h1>Acme Pain Points Summary</h1>",
        #f"  <div class=\"meta\">Vectorization: {escape(str(vec_mode))}; clusters: {k}</div>",
    ]

    for idx, (ci, count, terms, exs, summary, rows, title, representative) in enumerate(summaries, start=1):
        html_lines.append("  <section>")
        #html_lines.append(f"    <h2>Cluster {ci} ({count})</h2>")
        if idx >= 2:
            html_lines.append("    <hr style=\"border:0;border-top:1px solid #dcdcdc;margin:1rem 0 1.25rem;\" />")
        if title:
            # Prefix with 1-based index and bold the number and title text
            html_lines.append(f"    <p class=\"title\"><strong>{idx}.</strong> <strong>{escape(title)}</strong></p>")
        if representative:
            html_lines.append(f"    <p class=\"representative\"><span style=\"color:#0f4c81\"><strong>Representative Customer Requests:</strong></span> <em>{escape(representative)}</em></p>")
        # Move Summary above Examples
        html_lines.append("    <div class=\"meta\"><strong style=\"color:#0f4c81\">Summary</strong></div>")
        summary_text = summary if summary else "(no summary)"
        html_lines.append(f"    <p class=\"summary\">{escape(summary_text)}</p>")
        if rows:
            html_lines.append("    <div class=\"meta\"><strong style=\"color:#0f4c81\">Examples</strong></div>")
            html_lines.append("    <ul>")
            for row in rows:
                try:
                    example = format_example(row, text_col)
                except Exception:
                    example = str(row.get(text_col, "")).strip()
                html_lines.append(f"      <li>{escape(example)}</li>")
            html_lines.append("    </ul>")
        html_lines.append("  </section>")

    html_lines.append("  <footer>Generated by analyze_feedback.py</footer>")
    html_lines.append("</body>")
    html_lines.append("</html>")

    with open("insights.html", "w", encoding="utf-8") as f:
        f.write("\n".join(html_lines))

    print("Wrote: pain_point_summary.csv, insights.md, insights.html")


if __name__ == "__main__":
    main()

