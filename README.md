# Automating Data Ingestion with AWS CDK

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
  public readonly unzipFunc: Function;
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

Next, we'll create a Lambda function to populate the SQS queue with messages. This function will be scheduled to run periodically using Amazon EventBridge.

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

In this section, we define a Lambda function (`populateQueueFunc`) responsible for populating the SQS queue with messages. We schedule this function to run every 30 minutes using an Amazon EventBridge rule (`rule`). The function retrieves data from a source (not shown) and adds messages to the SQS queue.

## Ingesting Data

Now, let's create a Lambda function to ingest data from the SQS queue and store it in the S3 bucket.

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
```

In this segment, we define a Lambda function (`ingestionFunc`) responsible for ingesting data from the SQS queue and storing it in the S3 bucket. We configure the function to process messages from the SQS queue in batches of 5 with a maximum concurrency of 5.

## Conclusion

In this blog post, we've demonstrated how to automate data ingestion workflows using AWS CDK. By leveraging serverless technologies such as Lambda, S3, SQS, and EventBridge, we can build scalable and resilient data pipelines that efficiently handle large volumes of data. This solution provides flexibility, scalability, and reliability, making it suitable for various data ingestion scenarios.
