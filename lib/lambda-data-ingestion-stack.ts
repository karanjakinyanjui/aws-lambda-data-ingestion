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
  // public readonly unzipFunc: Function;
  public readonly queue: Queue;

  constructor(scope: Construct, id: string, props?: cdk.StackProps) {
    super(scope, id, props);

    this.destBucket = new Bucket(this, "DataIngestionBucket", {
      bucketName: "data-ingestion-bucket-20240313",
    });

    this.queue = new Queue(this, "DataIngestionQueue", {
      queueName: "data-ingestion-queue-20240313",
      visibilityTimeout: cdk.Duration.seconds(300),
    });

    this.baseLayer = new LayerVersion(this, "BaseLayer", {
      layerVersionName: "python-requests-layer",
      description: "Base layer with requests lib",
      compatibleRuntimes: [cdk.aws_lambda.Runtime.PYTHON_3_11],
      code: cdk.aws_lambda.Code.fromAsset("functions/packages"),
    });

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

    // Schedule to run every 30 minutes
    const rule = new Rule(this, "PopulateQueueRule", {
      ruleName: "data-ingestion-populate-queue-rule",
      schedule: cdk.aws_events.Schedule.rate(cdk.Duration.minutes(30)),
      description: "Populate queue rule",
      enabled: true,
    });

    rule.addTarget(
      new cdk.aws_events_targets.LambdaFunction(this.populateQueueFunc)
    );

    this.ingestionFunc = new Function(this, "IngestionFunction", {
      functionName: "data-ingestion-function",
      runtime: cdk.aws_lambda.Runtime.PYTHON_3_11,
      code: cdk.aws_lambda.Code.fromAsset("functions/ingestion"),
      layers: [this.baseLayer],
      handler: "lambda_function.handler",
      memorySize: 512,
      reservedConcurrentExecutions: 10,
      timeout: cdk.Duration.seconds(300),
      environment: {
        DEST_BUCKET_NAME: this.destBucket.bucketName,
        PREFIX: "raw",
        QUEUE_URL: this.queue.queueUrl,
      },
    });

    this.ingestionFunc.addEventSource(
      new SqsEventSource(this.queue, {
        batchSize: 5,
      })
    );
    this.queue.grantConsumeMessages(this.ingestionFunc);
    this.destBucket.grantReadWrite(this.ingestionFunc);
  }
}
