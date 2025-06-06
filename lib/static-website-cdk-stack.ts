import * as cdk from 'aws-cdk-lib';
import { Construct } from 'constructs';
import * as s3 from 'aws-cdk-lib/aws-s3';
import * as cloudfront from 'aws-cdk-lib/aws-cloudfront';
import * as origins from 'aws-cdk-lib/aws-cloudfront-origins';
import * as iam from 'aws-cdk-lib/aws-iam';
import * as codebuild from 'aws-cdk-lib/aws-codebuild';
import * as codepipeline from 'aws-cdk-lib/aws-codepipeline';
import * as codepipeline_actions from 'aws-cdk-lib/aws-codepipeline-actions';
import * as secretsmanager from 'aws-cdk-lib/aws-secretsmanager';
// We remove the import for cloudfront_functions as we'll define the function inline
// import * as cloudfront_functions from 'aws-cdk-lib/aws-cloudfront-functions';
import { config } from '../config/config';
// import * as sqs from 'aws-cdk-lib/aws-sqs';

// Define the main stack for our static website deployment
export class StaticWebsiteCdkStack extends cdk.Stack {
  constructor(scope: Construct, id: string, props?: cdk.StackProps) {
    super(scope, id, props);

    // --- S3 Bucket for Static Website Assets ---
    // This bucket will store the built static files (HTML, CSS, JS, etc.)
    const websiteBucket = new s3.Bucket(this, 'WebsiteBucket', {
      bucketName: config.resources.s3.bucketName, // Get bucket name from config
      // Configure for development for easy cleanup
      removalPolicy: cdk.RemovalPolicy.DESTROY, 
      autoDeleteObjects: true, 
      blockPublicAccess: s3.BlockPublicAccess.BLOCK_ALL, // Ensure the bucket is private
      encryption: s3.BucketEncryption.S3_MANAGED, // Use S3-managed encryption
    });

    // --- CloudFront Origin Access Identity (OAI) ---
    // OAI is used to securely access the S3 bucket from CloudFront
    const originAccessIdentity = new cloudfront.OriginAccessIdentity(this, 'OriginAccessIdentity', {
      comment: config.resources.cloudfront.oaiComment, // Comment for the OAI
    });

    // Grant CloudFront (via OAI) read permissions to the S3 bucket
    websiteBucket.grantRead(originAccessIdentity);

    // --- CloudFront Function for URL Rewriting ---
    // This function rewrites URLs to serve index.html for directory paths
    const rewriteFunctionCode = `
      function handler(event) {
        var request = event.request;
        var uri = request.uri;

        // Check whether the URI is missing a file name (ends with /) or has no file extension.
        if (uri.endsWith('/')) {
          request.uri += 'index.html';
        } else if (!uri.includes('.')) {
          request.uri += '/index.html';
        }

        return request;
      }
    `;

    // --- CloudFront Distribution ---
    // This distributes the static assets globally via CDN
    const distribution = new cloudfront.Distribution(this, 'Distribution', {
      defaultBehavior: {
        origin: new origins.S3Origin(websiteBucket, {
          originAccessIdentity, // Associate OAI with the S3 origin
        }),
        viewerProtocolPolicy: cloudfront.ViewerProtocolPolicy.REDIRECT_TO_HTTPS, // Force HTTPS
        cachePolicy: cloudfront.CachePolicy.CACHING_OPTIMIZED, // Use optimized caching
        // Associate the rewrite function with the default behavior for viewer requests
        functionAssociations: [{
          function: new cloudfront.Function(this, 'RewriteFunction', { // Define function inline
            functionName: `${config.projectName}-rewrite-function-${config.environment}`, // Function name from config
            code: cloudfront.FunctionCode.fromInline(rewriteFunctionCode), // Inline function code
          }),
          eventType: cloudfront.FunctionEventType.VIEWER_REQUEST, // Trigger on viewer request
        }],
      },
      defaultRootObject: config.cloudfront.defaultRootObject, // Set default root object (index.html)
      errorResponses: config.cloudfront.errorResponses, // Configure error responses (e.g., 404 to index.html)
    });

    // --- AWS Secrets Manager (GitHub Token) ---
    // Reference the existing secret for GitHub authentication
    const githubToken = secretsmanager.Secret.fromSecretNameV2(
      this,
      'GitHubToken',
      config.resources.secrets.githubTokenName // Secret name from config
    );

    // --- AWS CodeBuild Project ---
    // Defines the build environment and steps for the static website
    const buildProject = new codebuild.PipelineProject(this, 'BuildProject', {
      projectName: config.resources.codebuild.projectName, // Project name from config
      environment: {
        buildImage: codebuild.LinuxBuildImage.STANDARD_7_0, // Use a standard build image
        privileged: true, // Needed for some build tools
      },
      buildSpec: codebuild.BuildSpec.fromObject(config.build.buildSpec), // Use build spec from config
    });

    // Grant CodeBuild permissions to write the build output to the S3 bucket
    websiteBucket.grantWrite(buildProject);

    // --- AWS CodePipeline ---
    // Orchestrates the CI/CD workflow (Source -> Build -> Deploy)
    const pipeline = new codepipeline.Pipeline(this, 'Pipeline', {
      pipelineName: config.resources.codepipeline.pipelineName, // Pipeline name from config
      crossAccountKeys: false, // Use default KMS keys for artifact bucket
    });

    // Add Source Stage (GitHub)
    const sourceOutput = new codepipeline.Artifact(); // Artifact to store source code
    const sourceAction = new codepipeline_actions.GitHubSourceAction({
      actionName: 'GitHub_Source', // Name of the action
      owner: config.github.owner, // GitHub owner from config
      repo: config.github.repo, // GitHub repository name from config
      branch: config.github.branch, // GitHub branch from config
      oauthToken: cdk.SecretValue.secretsManager(githubToken.secretName), // Use token from Secrets Manager
      output: sourceOutput, // Store source code in this artifact
    });
    pipeline.addStage({
      stageName: 'Source', // Name of the stage
      actions: [sourceAction], // Add the source action to the stage
    });

    // Add Build Stage (CodeBuild)
    const buildOutput = new codepipeline.Artifact(); // Artifact to store build output
    const buildAction = new codepipeline_actions.CodeBuildAction({
      actionName: 'Build', // Name of the action
      project: buildProject, // Associate with our CodeBuild project
      input: sourceOutput, // Take source code as input
      outputs: [buildOutput], // Output build artifacts
    });
    pipeline.addStage({
      stageName: 'Build', // Name of the stage
      actions: [buildAction], // Add the build action to the stage
    });

    // Add Deploy Stage (S3 Deployment)
    const deployAction = new codepipeline_actions.S3DeployAction({
      actionName: 'Deploy', // Name of the action
      input: buildOutput, // Take build output as input
      bucket: websiteBucket, // Deploy to the website S3 bucket
      extract: true, // Extract the build artifact (zip file) into the bucket
    });
    pipeline.addStage({
      stageName: 'Deploy', // Name of the stage
      actions: [deployAction], // Add the deploy action to the stage
    });

    // --- CDK Outputs ---
    // Output the CloudFront distribution domain name after deployment
    new cdk.CfnOutput(this, 'DistributionDomainName', {
      value: distribution.distributionDomainName, // Get the domain name from the distribution construct
      description: 'CloudFront Distribution Domain Name', // Description for the output
    });

    // The code that defines your stack goes here

    // example resource
    // const queue = new sqs.Queue(this, 'StaticWebsiteCdkQueue', {
    //   visibilityTimeout: cdk.Duration.seconds(300)
    // });
  }
}
