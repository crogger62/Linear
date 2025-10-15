# ⚡ Linear API Learning Project

> A collection of small TypeScript scripts exploring the [Linear API](https://linear.app/developers/graphql).  
> These examples demonstrate authentication, querying, filtering, issue creation, and webhook integration.

---

## 📘 Overview

This project is designed to help you learn how to interact with Linear’s GraphQL API using Node.js and TypeScript.  
Each script demonstrates a specific API feature — from basic queries to webhook handling.

---

## 🧩 Project Scripts

| File | Description |
|------|--------------|
| **`me.ts`** | Displays the current user authenticated via your Linear API key. |
| **`teams.ts`** | Lists all teams visible to the API key. |
| **`myIssueCounts.ts`** | Counts issues by workflow state for the current user.<br>Use `--include-archived` to include archived issues. |
| **`createIssue-annotated.ts`** | Creates a new issue from the command line.<br>Includes inline documentation and supports the following flags:<br><br>• `--team "team name"` — defaults to the current user’s team<br>• `--title "title name"` — defaults to a timestamp<br>• `--include-archived` — include archived issues |
| **`issuesFiltered-annotated.ts`** | Filters issues using several flags:<br><br>• `--email "emailid"`<br>• `--label "label name"`<br>• `--state "workflow state name"`<br>• `--since N` — issues updated in the last *N* days<br>• `--include-archived` — include archived issues |
| **`webhook-server.ts`** | Simple Express-based app to trial webhooks using a lightweight HTML interface.<br>See comments in source for setup and usage instructions. |
| **`listIssuePaginated.ts`** | List all issues using cursor / pagination. | | **`listIssuePaginated.ts`** | List all issues using cursor / pagination. || **`listIssuePaginated.ts`** | List all issues using cursor / pagination. | | **`listIssuePaginated.ts`** | List all issues using cursor / pagination. |
| **`workspaceSnapshot.ts`** | Collects all open Linear issues and summarizes them by project, workflow state, and assignee and outputs them as Markdown or CSV showing open-issu details, active projects and workload per user | 

---

## ⚙️ Setup

### 1️⃣ Prerequisites
- Node.js (v20+ recommended)  
- TypeScript  
- Linear API key  

### 2️⃣ Installation
```bash
git clone https://github.com/<yourusername>/linear.git
cd linear
npm install
