## Introduction

Data ingestion, the process of collecting and importing data for storage and analysis, is a crucial step in many data pipelines. In this blog post, we'll explore how to automate data ingestion workflows using the AWS Cloud Development Kit (CDK). We'll build a serverless solution that utilizes AWS Lambda functions, Amazon S3 buckets, Amazon SQS queues, and Amazon EventBridge (formerly known as CloudWatch Events).

## Overview

Our goal is to create a scalable and resilient data ingestion system that automates the process of collecting data from various sources and storing it in an Amazon S3 bucket. We'll leverage AWS CDK, a software development framework for defining cloud infrastructure in code, to provision and manage our AWS resources.

## Setting Up the Environment

First, let's define the necessary AWS resources in our CDK stack. We'll create an Amazon S3 bucket to store the ingested data, an Amazon SQS queue to manage the ingestion workflow, and a Lambda layer containing common dependencies.

```typescript
import * as cdk from "aws-cdk-lib";
import { Construct } from "constructs";
import { Function, LayerVersion } from "aws-cdk-lib/aws-lambda";
import { Bucket } from "aws-cdk-lib/aws-s3";
import { Queue } from "aws-cdk-lib/aws-sqs";
import { SqsEventSource } from "aws-cdk-lib/aws-lambda-event-sources";
import { Rule } from "aws-cdk-lib/aws-events";

export class LambdaDataIngestionStack extends cdk.Stack {
  public readonly baseLayer: LayerVersion;
  public readonly destBucket: Bucket;
  public readonly populateQueueFunc: Function;
  public readonly ingestionFunc: Function;
  public readonly queue: Queue;

  constructor(scope: Construct, id: string, props?: cdk.StackProps) {
    super(scope, id, props);

    // Create S3 bucket for data ingestion
    this.destBucket = new Bucket(this, "DataIngestionBucket", {
      bucketName: "data-ingestion-bucket-20240313",
    });

    // Create SQS queue for ingestion workflow
    this.queue = new Queue(this, "DataIngestionQueue", {
      queueName: "data-ingestion-queue-20240313",
      visibilityTimeout: cdk.Duration.seconds(300),
    });

    // Define Lambda layer with common dependencies
    this.baseLayer = new LayerVersion(this, "BaseLayer", {
      layerVersionName: "python-requests-layer",
      description: "Base layer with requests lib",
      compatibleRuntimes: [cdk.aws_lambda.Runtime.PYTHON_3_11],
      code: cdk.aws_lambda.Code.fromAsset("functions/packages"),
    });
```

In this block of code, we create an Amazon S3 bucket (`destBucket`) to store the ingested data and an Amazon SQS queue (`queue`) to manage the ingestion workflow. We also define a Lambda layer (`baseLayer`) containing common dependencies, such as the `requests` library.

## Populating the Queue

### Infrastructure

Next, we'll provision a Lambda function to populate the SQS queue with messages. This function will be scheduled to run periodically using Amazon EventBridge.

```typescript
// Lambda function to populate the SQS queue
this.populateQueueFunc = new Function(this, "PopulateQueueFunction", {
  functionName: "data-ingestion-populate-queue-function",
  runtime: cdk.aws_lambda.Runtime.PYTHON_3_11,
  code: cdk.aws_lambda.Code.fromAsset("functions/populate_queue"),
  layers: [this.baseLayer],
  handler: "lambda_function.handler",
  memorySize: 512,
  timeout: cdk.Duration.seconds(900),
  environment: {
    BUCKET_NAME: this.destBucket.bucketName,
    QUEUE_URL: this.queue.queueUrl,
    BOOKMARK_KEY: "bookmark.txt",
  },
});
this.destBucket.grantReadWrite(this.populateQueueFunc);
this.queue.grantSendMessages(this.populateQueueFunc);

// Schedule Lambda function to run every 30 minutes
const rule = new Rule(this, "PopulateQueueRule", {
  ruleName: "data-ingestion-populate-queue-rule",
  schedule: cdk.aws_events.Schedule.rate(cdk.Duration.minutes(30)),
  description: "Populate queue rule",
  enabled: true,
});

rule.addTarget(
  new cdk.aws_events_targets.LambdaFunction(this.populateQueueFunc)
);
```

In this section, we define a Lambda function (`populateQueueFunc`) responsible for populating the SQS queue with messages. We give the function sufficient permissions to read and write to the bucket as well as send messages to the queue. We schedule this function to run every 30 minutes using an Amazon EventBridge rule (`rule`). The function retrieves data from GitHub Archives and adds messages to the SQS queue.

### Queue Population Function Implementation

The lambda handler for populating the queue is shown below:

```python
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
```

The implemented solution leverages a bookmarking mechanism, utilizing an S3 object to store the filename of the last processed data file. This enables seamless resumption of data processing from the point of interruption. Through iterative data processing, the Lambda function systematically scans potential data files on GitHub Archive, verifying their availability via HTTP HEAD requests. Upon discovering a new data file, its filename is promptly added to an SQS queue for subsequent processing. The bookmark is updated in S3 periodically to safeguard against the function timing out and to maintain continuity in processing operations.

## Ingesting Data

### Infrastructure

Now, let's provision a Lambda function to ingest data from the SQS queue and store it in the S3 bucket.

```typescript
// Lambda function to ingest data from SQS queue
this.ingestionFunc = new Function(this, "IngestionFunction", {
  functionName: "data-ingestion-function",
  runtime: cdk.aws_lambda.Runtime.PYTHON_3_11,
  code: cdk.aws_lambda.Code.fromAsset("functions/ingestion"),
  layers: [this.baseLayer],
  handler: "lambda_function.handler",
  memorySize: 512,
  timeout: cdk.Duration.seconds(300),
  environment: {
    DEST_BUCKET_NAME: this.destBucket.bucketName,
    PREFIX: "raw",
    QUEUE_URL: this.queue.queueUrl,
  },
});

// Configure ingestion function to process messages from SQS queue
this.ingestionFunc.addEventSource(
  new SqsEventSource(this.queue, {
    batchSize: 5,
    maxConcurrency: 5,
  })
);

this.queue.grantConsumeMessages(this.ingestionFunc);
this.destBucket.grantReadWrite(this.ingestionFunc);
```

In this segment, we provision a Lambda function (`ingestionFunc`) responsible for ingesting data from the SQS queue and storing it in the S3 bucket. We configure the function to process messages from the SQS queue in batches of 5 with a maximum concurrency of 5. We then grant the ingestion function the permissions to consume messages from the queue and to read and write to the S3 bucket.

### Data Ingestion Function

```python
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

```

The Lambda function responds to new messages in the SQS queue. It retrieves each message, extracts the filename, and downloads the corresponding data file from a URL constructed using the filename. This file is then uploaded to an Amazon S3 bucket designated by predefined parameters. Upon successful transfer, the Lambda function removes the processed message from the SQS queue to prevent duplication. This streamlined process ensures the efficient and reliable transfer of data files from SQS to S3, facilitating automated and scalable data handling operations.

## Conclusion

In this blog post, we've demonstrated how to automate data ingestion workflows using AWS CDK. By leveraging serverless technologies such as Lambda, S3, SQS, and EventBridge, we can build scalable and resilient data pipelines that efficiently handle large volumes of data. This solution provides flexibility, scalability, and reliability, making it suitable for various data ingestion scenarios.
