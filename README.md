# Full details below - to run the customer request analyzer script: 
0) Runs in Linux
1) Ensure you have a Linear API key in your .env file. You can requeest one in the Settings->API section in the Linear app. See the example .env file.
2) You need an OPENAPI key as well,OPENAI_API_KEY in your linux environment.
3) The script run.sh in the project directory should run the app, spawn the web page and get access to Linear (project and issue data should prepopulate).
4) During execution, an insights.md file is created along with the output. The file customerRequests.csv will have the raw customer request data.

Note the python requirements - a few packages are requrired. Developed with Python 3.13.5

You can download the customer records only using:
'npx ts-node src/customerRequests.ts'- there is an optional debug flag ---debug that will show diagnostic information.

You can process the downloaded records using:
'python3 feedback_analysis/analyze_feedback.py CustomerRequests.csv" - there is an optional debug flag --debug that will show diagnostic information. If you run it in this mode, only 

Webpage will be here: http://localhost:3100/picker.html

Good luck. Have fun. I did!

# 🔎 Customer Request Analyzer (Linear + TypeScript + Python)

Export customer requests from Linear, cluster and summarize them, and view the insights in a simple web UI.

## What’s inside

- Picker web UI (served by Node/TypeScript)
	- Select one of: All customer records (entire workspace), a single project, or a single issue
	- Start an export and automatically run an analysis
	- Live logs via SSE and an embedded insights view
- Exporter (TypeScript)
	- Generates `CustomerRequests.csv` from the selected scope
- Analyzer (Python)
	- Clusters requests, generates titles/summaries (optionally via OpenAI), and writes `insights.html` and `insights.md`

## Requirements

- Node.js 18+ (20+ recommended)
- Python 3.10+
- A Linear API key (required)
- Optional: OpenAI API key (improves cluster titles/summaries)

## Quickstart

1) Clone and install

```bash
git clone https://github.com/<your-org>/<your-repo>.git
cd <your-repo>
npm install
```

2) Configure environment

```bash
cp .env.example .env
# Edit .env and set LINEAR_API_KEY (and optional OPENAI_API_KEY)
```

3) Run the picker server and open the UI

```bash
# Development (ts-node)
npm run dev
# Open http://localhost:3100/picker.html (or use PICKER_PORT in .env)
```

4) Click “Analyze Customer Requests”

- Exports the selected scope to `CustomerRequests.csv`
- Runs `./run_analysis.sh` (creates `feedback-analysis/.venv`, installs Python deps, executes analyzer)
- Streams logs and embeds `insights.html` results in the page

## CLI alternatives

```bash
# Export only
npm run export

# Analyze only (uses CustomerRequests.csv)
npm run analyze
```

## Build and run from dist

```bash
# Compile TypeScript -> dist/
npm run build

# Start compiled server
npm run start:dist
# Open http://localhost:3100/picker.html
```

## One-time bootstrap (optional)

```bash
./bootstrap.sh
# Builds TS, installs Node/Python deps, prepares a Python venv, and prints next steps
```

## Configuration

- `LINEAR_API_KEY` (required): Linear API key with read access to projects/issues
- `PICKER_PORT` (optional): UI/server port (default 3100)
- `OPENAI_API_KEY` (optional): enables better titles/summaries

## Outputs

- `CustomerRequests.csv` — exported input data
- `pain_point_summary.csv` — examples per cluster
- `insights.html` — embeddable HTML report (the UI injects only the `<body>`)
- `insights.md` — Markdown report

## Scripts

- `npm run dev` — start the picker server in ts-node
- `npm run picker` — alias for dev
- `npm run build` — compile to `dist/`
- `npm run start:dist` — run compiled server
- `npm run export` — run the exporter
- `npm run analyze` — run the Python analysis via `run_analysis.sh`

## Troubleshooting

- Missing LINEAR_API_KEY
	- Set it in `.env` and restart the server
- Python dependency issues
	- Run `npm run analyze` once to create venv and install `feedback-analysis/requirements.txt`
- `insights.html` not fully rendering in the UI
	- The UI injects only the `<body>` contents; the generator already inlines key styles for labels
- LLM not used
	- Ensure `OPENAI_API_KEY` is set in `.env` (when running via the server) or exported in your shell (when running Python directly)

## Project layout

- `public/` — static assets for the UI (`picker.html`, images)
- `src/` — TypeScript sources
	- `customerRequests-server.ts` — web server + APIs + SSE
	- `customerRequests.ts` — CSV exporter
- `feedback-analysis/` — Python analyzer
	- `analyze_feedback.py` — clustering, summaries, and report writer
	- `requirements.txt` — Python dependencies
- `run_analysis.sh` — sets up venv and runs the analyzer
- `.env.example` — environment template

---

If you’d like a Dockerfile (single-image Node+Python) or CI workflow, I can add those too.
