#/bin/bash
#
source feedback-analysis/.venv/bin/activate
python3 feedback-analysis/analyze_feedback.py ./CustomerRequests.csv > /dev/null


