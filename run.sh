#/bin/bash
#
cd ~/linear-cli
# 1. Download records from Linear
npx ts-node src/customerRequests.ts
# files end up in CustomerRequests.csv
#
# 2. Run python script
#
# Setup venv
source feedback-analysis/.venv/bin/activate
python3 feedback-analysis/analyze_feedback.py ./CustomerRequests.csv
#
#

