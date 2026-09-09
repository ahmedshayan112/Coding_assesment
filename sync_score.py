import json
import pymongo
from datetime import datetime

MONGO_URI = "mongodb+srv://char3d_userA:NS.AI2026@cluster0.vgyhy5m.mongodb.net/Recruitment?retryWrites=true&w=majority"
client = pymongo.MongoClient(MONGO_URI)
db = client["Recruitment"]

with open("submissions/sub-1788956449.json", "r", encoding="utf-8") as f:
    scorecard = json.load(f)

score = scorecard.get("overall_score", 100)
email = scorecard.get("candidate_email", "abdullahqasim771@gmail.com")

res = db["candidates"].update_many(
    {"email": email},
    {
        "$set": {
            "codingStatus": "completed",
            "codingCompleted": True,
            "codingScore": score,
            "codingScorecard": scorecard,
            "codingCompletedAt": datetime.utcnow(),
            "finalScore": score  # Also update finalScore so final grade shows 100%
        }
    }
)

print(f"Successfully updated candidate {email}: modified={res.modified_count}")
