# Linear

Project to learn to access the Linear (linear.app) API (see https://linear.app/developers/graphql)

* me.ts - Simple app to show the current user

* teams.ts - List teams visible to API key

* myIssueCounts.ts - Counts by workflow state for current user; add flag 

  --include-archived as needed

* createIssue-annotated.ts - Commented version of an app to create an issue from the command line; flags:

  --team <teamname> defaults to current user's team
  
  --title <title name> defaults to timedate stamp
  
  --include-archived as needed

* issuesFiltered-annotated.ts - Commented version of an app to filter issues based on several flags: 
  
  --email "emailid"
  
  --label "label name"
  
  --state "workflow state name"
  
  --since N   (only issues updated in last N days)
  
  --include-archived  (include archived issues in results)

* webhook-server.ts - app to trial webhook using simple html page; see source for running instructions

Typescript apps to create an issue, list issues (w/filtering), produce a count of issues per user and use of a webhook to catch various events defined in the API.

Requires Linear API key in .env
Webhook-server.ts requires webhook API key in .env. which you can get here: https://linear.app/crog/settings/api

Versions with "-annotated" have additional comments



