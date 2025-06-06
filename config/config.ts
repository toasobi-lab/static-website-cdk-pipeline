import { ErrorResponse } from 'aws-cdk-lib/aws-cloudfront';

// Base configuration: project name and environment
const baseConfig = {
  projectName: 'static-website-deploy', // Descriptive name for the project
  environment: 'poc', // Environment name (e.g., 'dev', 'staging', 'prod', 'poc')
} as const;

// Helper function to generate consistent resource names
const getResourceName = (resourceType: string) => 
  `${baseConfig.projectName}-${resourceType}-${baseConfig.environment}`;

// Main configuration object
export const config = {
  // Spread base configuration properties here
  ...baseConfig,

  // Resource naming configurations
  resources: {
    s3: {
      bucketName: getResourceName('s3-assets'), // S3 bucket name for static assets
    },
    cloudfront: {
      distributionName: getResourceName('cloudfront-static'), // CloudFront distribution name
      oaiComment: `OAI for ${baseConfig.projectName} static website`, // Comment for the Origin Access Identity
    },
    codebuild: {
      projectName: getResourceName('codebuild-static'), // CodeBuild project name
    },
    codepipeline: {
      pipelineName: getResourceName('codepipeline-static'), // CodePipeline name
    },
    secrets: {
      githubTokenName: getResourceName('github-token'), // AWS Secrets Manager secret name for GitHub token
    },
  },

  // GitHub repository configuration for CodePipeline source
  github: {
    owner: 'toasobi-lab', // GitHub username or organization
    repo: 'astro-platform-starter', // GitHub repository name
    branch: 'main', // Branch to track for pipeline triggers
  },

  // AWS CodeBuild build specification
  build: {
    buildSpec: {
      version: '0.2',
      phases: {
        install: {
          'runtime-versions': {
            nodejs: '20', // Specify Node.js version for the build environment
          },
          commands: [
            'npm install', // Command to install project dependencies
          ],
        },
        build: {
          commands: [
            'npm run build', // Command to build the static website
          ],
        },
      },
      artifacts: {
        files: [
          '**/*', // Include all files in the build output
        ],
        'base-directory': 'dist', // Specify the directory containing the build output
      },
    },
  },

  // CloudFront distribution specific configurations
  cloudfront: {
    defaultRootObject: 'index.html', // File to serve when the root URL is accessed
    errorResponses: [
      { // Configure 404 errors to return index.html (useful for SPAs/static sites)
        httpStatus: 404,
        responseHttpStatus: 200,
        responsePagePath: '/index.html',
      },
    ] as ErrorResponse[], // Cast to the correct type for CloudFront error responses
  },
} as const;

// Type definition for the config object to provide type safety
export type Config = typeof config; 