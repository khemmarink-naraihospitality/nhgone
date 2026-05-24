import urllib.request
import json

payload = {
    "property": "Lub d Bangkok Chinatown",
    "data": [
        {
            "Identifier": "test-sync-issue-id",
            "Number": "99999",
            "State": "Confirmed"
        }
    ]
}

data = json.dumps(payload).encode('utf-8')
req = urllib.request.Request("https://one.naraihospitalitygroup.com/api/reservations/sync-manual", data=data, headers={'Content-Type': 'application/json'})

try:
    response = urllib.request.urlopen(req)
    print("Status:", response.status)
    print("Body:", response.read().decode('utf-8'))
except urllib.error.HTTPError as e:
    print("Error Status:", e.code)
    print("Error Body:", e.read().decode('utf-8'))
