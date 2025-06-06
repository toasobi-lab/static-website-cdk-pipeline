#!/usr/bin/env node
import * as cdk from 'aws-cdk-lib';
import { StaticWebsiteCdkStack } from '../lib/static-website-cdk-stack';
import { config } from '../config/config';

const app = new cdk.App();

// Create the stack with environment configuration
new StaticWebsiteCdkStack(app, `${config.projectName}-stack`, {
  env: {
    account: process.env.CDK_DEFAULT_ACCOUNT,
    region: process.env.CDK_DEFAULT_REGION,
  },
  description: `Static website deployment stack for ${config.projectName} (${config.environment})`,
  tags: {
    Project: config.projectName,
    Environment: config.environment,
  },
});