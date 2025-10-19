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
from typing import List, Tuple

import numpy as np
import pandas as pd
from sklearn.cluster import KMeans
from sklearn.metrics import silhouette_score
from sklearn.feature_extraction.text import TfidfVectorizer

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
def load_texts(csv_path: str) -> List[str]:
    """
    Robust loader that:
      - infers delimiter
      - normalizes headers
      - drops Excel 'Unnamed' columns
      - auto-detects the most 'text-like' column if 'text' not present
    """
    df = pd.read_csv(csv_path, sep=None, engine="python")

    # Normalize column names
    df.columns = [str(c).strip().lower() for c in df.columns]

    # Drop unnamed index columns
    df = df.loc[:, [c for c in df.columns if not re.match(r"^unnamed:?\s*\d*$", c)]]

    # Preferred column
    if "text" in df.columns:
        col = "text"
    else:
        # Common synonyms
        candidates = [
            "request", "customer request", "feedback", "comment",
            "description", "body", "message", "notes", "issue", "content"
        ]
        col = next((c for c in df.columns if c in candidates), None)

        if col is None:
            # Choose most "text-like" column by length & non-null ratio + name hint
            def score_series(s: pd.Series):
                nonnull = s.dropna().astype(str)
                avg_len = nonnull.map(len).mean() if len(nonnull) else 0.0
                frac_nonnull = len(nonnull) / max(len(s), 1)
                name_bonus = 5.0 if re.search(r"text|request|feedback|comment|desc|message|notes|issue|content",
                                               s.name or "") else 0.0
                return frac_nonnull * 10.0 + (avg_len / 50.0) + name_bonus

            col = max(df.columns, key=lambda c: score_series(df[c]))

    texts = (
        df[col]
        .astype(str)
        .map(lambda s: s.strip())
        .replace({"": pd.NA})
        .dropna()
        .tolist()
    )
    if not texts:
        raise ValueError("No non-empty text rows found after parsing.")
    return texts


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
    vec = TfidfVectorizer(
        ngram_range=(1, 2),
        min_df=1,
        max_df=0.95,
        strip_accents="unicode"
    )
    X = vec.fit_transform(texts)
    # Return dense for KMeans; for large corpora consider MiniBatchKMeans with sparse
    return X.toarray()


# ------------------------------ CLUSTERING ----------------------------------
def choose_k_auto(X: np.ndarray, k_min: int, k_max: int) -> int:
    """
    Auto-select K using silhouette score within [k_min, k_max].
    Requires >= (k_max) samples; otherwise clamps to feasible range.
    """
    n = X.shape[0]
    k_max_eff = max(k_min, min(k_max, n - 1))  # silhouette needs at least k < n
    best_k, best_score = k_min, -1.0
    for k in range(k_min, k_max_eff + 1):
        try:
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


def cluster_texts(X: np.ndarray, k: int) -> Tuple[np.ndarray, KMeans]:
    km = KMeans(n_clusters=k, n_init="auto", random_state=42)
    km.fit(X)
    return km.labels_, km


# ---------------------------- SUMMARIZATION ---------------------------------
def summarize_cluster_llm(texts: List[str]) -> str:
    """
    Use an LLM to generate a crisp pain-point summary with nuance & implied intent.
    """
    if _openai_client is None:
        return ""
    joined = "\n".join(f"- {t}" for t in texts[:50])  # cap prompt size
    prompt = (
        "You are helping a PM/CSM synthesize customer feedback.\n"
        "Given the sample requests below, write 2–4 sentences that:\n"
        "• Name the core pain point in plain language\n"
        "• Describe nuance (e.g., frustration/confusion, expectations)\n"
        "• Infer likely intent type(s): Bug, Feature Request, Usability/UX, Documentation/Clarity, Performance/Quality\n"
        "Be concise and non-marketing.\n\n"
        f"Sample requests:\n{joined}\n"
    )
    try:
        resp = _openai_client.chat.completions.create(
            model="gpt-4o-mini",
            messages=[
                {"role": "system", "content": "Be precise, concise, and analytical."},
                {"role": "user", "content": prompt},
            ],
            temperature=0.2,
        )
        return resp.choices[0].message.content.strip()
    except Exception as e:
        return f"(LLM summarization unavailable: {e})"


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
def top_terms_for_cluster(texts: List[str], all_texts: List[str], n_terms: int = 8) -> List[str]:
    """
    Compute top distinguishing terms for a cluster via TF-IDF against the whole corpus.
    """
    vec = TfidfVectorizer(
        ngram_range=(1, 2),
        min_df=1,
        max_df=0.95,
        strip_accents="unicode"
    )
    # Fit on all texts; transform cluster texts
    vec.fit(all_texts)
    Xc = vec.transform(texts)
    # Average TF-IDF for this cluster
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


# --------------------------------- MAIN -------------------------------------
def main():
    ap = argparse.ArgumentParser(description="Cluster & summarize customer requests.")
    ap.add_argument("csv_path", help="Path to CSV of requests (any text column).")
    ap.add_argument("--k", type=int, default=None, help="Force number of clusters.")
    ap.add_argument("--max-clusters", type=int, default=8, help="Upper bound for auto K.")
    ap.add_argument("--min-clusters", type=int, default=2, help="Lower bound for auto K.")
    ap.add_argument("--samples", type=int, default=3, help="Examples per cluster in outputs.")
    args = ap.parse_args()

    # Load & normalize
    texts_raw = load_texts(args.csv_path)
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

    # Choose K
    if args.k:
        k = max(1, min(args.k, len(texts) - 1))
    else:
        k = choose_k_auto(X, args.min_clusters, args.max_clusters)
        # As a last resort if silhouette failed everywhere:
        if not (args.min_clusters <= k <= args.max_clusters):
            k = min(max(args.min_clusters, 2), max(2, min(args.max_clusters, len(texts) - 1)))

    # Cluster
    labels, km = cluster_texts(X, k)

    # Group texts by cluster
    clusters = []
    for ci in range(k):
        idxs = np.where(labels == ci)[0]
        items = [texts_raw[i] for i in idxs]  # use raw originals for readability
        clusters.append((ci, items))

    # Rank by cluster size (desc)
    clusters.sort(key=lambda tpl: len(tpl[1]), reverse=True)

    # Summarize clusters
    summaries = []
    for ci, items in clusters:
        terms = top_terms_for_cluster([t.lower() for t in items], [t.lower() for t in texts_raw])
        if _openai_client and vec_mode == "embeddings":
            summary = summarize_cluster_llm(items)
            if not summary:
                summary = heuristic_summary(items, terms)
        else:
            summary = heuristic_summary(items, terms)
        summaries.append((ci, len(items), terms, pick_examples(items, args.samples), summary))

    # -------- Console Output --------
    print("\n=== Top Pain-Point Clusters ===")
    for ci, count, terms, exs, summary in summaries:
        print(f"[Cluster {ci}] count={count}  key_terms={', '.join(terms[:6])}")
        for e in exs:
            print(f"  - {e}")
        print(f"  summary: {summary}\n")

    # -------- CSV Output --------
    # pain_point_summary.csv with examples per row
    max_examples = max((len(exs) for *_rest, exs, _sum in summaries), default=args.samples)
    cols = ["Cluster", "Count"] + [f"Example_{i+1}" for i in range(max_examples)]
    rows = []
    for ci, count, _terms, exs, _summary in summaries:
        row = [ci, count] + exs + [""] * (max_examples - len(exs))
        rows.append(row)
    pd.DataFrame(rows, columns=cols).to_csv("pain_point_summary.csv", index=False)

    # -------- Markdown Output --------
    md_lines = ["# Pain Points Summary\n"]
    md_lines.append(f"_Vectorization: {vec_mode}; clusters: {k}_\n")
    for ci, count, terms, exs, summary in summaries:
        md_lines.append(f"## Cluster {ci} ({count})")
        md_lines.append(f"**Key terms:** {', '.join(terms)}")
        md_lines.append("")
        if exs:
            md_lines.append("**Examples:**")
            for e in exs:
                md_lines.append(f"- {e}")
            md_lines.append("")
        md_lines.append("**Summary:**")
        md_lines.append(summary if summary else "(no summary)")
        md_lines.append("")
    with open("insights.md", "w", encoding="utf-8") as f:
        f.write("\n".join(md_lines))

    print("Wrote: pain_point_summary.csv, insights.md")


if __name__ == "__main__":
    main()

