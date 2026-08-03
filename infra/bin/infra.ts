#!/usr/bin/env node
import { App } from 'aws-cdk-lib';
import { BudgetStack } from '../lib/budget-stack';

const app = new App();

// CI assumes the account's existing GithubDeploy role, so there is no CI stack
// here. Adding a repository to that role's trust policy is a manual step.
new BudgetStack(app, 'Budget', {
  env: {
    account: process.env.CDK_DEFAULT_ACCOUNT,
    region: process.env.CDK_DEFAULT_REGION ?? 'eu-north-1',
  },
});
