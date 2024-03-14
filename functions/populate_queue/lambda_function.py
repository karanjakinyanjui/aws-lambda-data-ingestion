from datetime import datetime as dt
from datetime import timedelta
import requests
import boto3
import os

sqs = boto3.client("sqs")
s3 = boto3.client("s3")
queue_url = os.environ["QUEUE_URL"]
bucket_name = os.environ["BUCKET_NAME"]
bookmark_key = os.environ["BOOKMARK_KEY"]


data_url = "https://data.gharchive.org/"


def save_bookmark(baseline_file):
    s3.put_object(Bucket=bucket_name, Key=bookmark_key, Body=baseline_file.encode())


def handler(event, context):
    baseline_file = "2023-03-13-1.json.gz"
    try:
        bookmark = (
            s3.get_object(Bucket=bucket_name, Key=bookmark_key)["Body"].read().decode()
        )
        baseline_file = bookmark
    except:
        save_bookmark(baseline_file)

    dt_part = baseline_file.split(".")[0]
    start_dt = dt.strptime(dt_part, "%Y-%M-%d-%H")
    for i in range(1, 300):
        start_dt += timedelta(hours=1)
        file_dt = start_dt.strftime("%Y-%M-%d-%-H")
        file_name = f"{file_dt}.json.gz"
        res = requests.head(data_url + file_name)
        if (res.status_code) == 200:
            sqs.send_message(
                QueueUrl=queue_url,
                MessageBody=file_name,
            )
            baseline_file = file_name
        else:
            break
        if i % 50 == 0:
            save_bookmark(file_name)
    save_bookmark(file_name)

    return {"statusCode": 200, "body": "success"}
