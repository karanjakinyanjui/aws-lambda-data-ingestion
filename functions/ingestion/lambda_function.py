import json
import requests
import boto3
import os

data_url = "https://data.gharchive.org/"
dest_bucket_name = os.environ["DEST_BUCKET_NAME"]
prefix = os.environ["PREFIX"]
queue_url = os.environ["QUEUE_URL"]

s3 = boto3.client("s3")
sqs = boto3.client("sqs")


def handler(event, context):
    for record in event.get("Records", []):
        file = record.get("body")
        res = requests.get(data_url + file)
        s3.put_object(Bucket=dest_bucket_name, Key=f"{prefix}/{file}", Body=res.content)
        sqs.delete_message(QueueUrl=queue_url, ReceiptHandle=record["receiptHandle"])
    return {"statusCode": 200, "body": "success"}
