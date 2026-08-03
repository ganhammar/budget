#!/usr/bin/env node
import { App } from 'aws-cdk-lib';
import { BudgetStack } from '../lib/budget-stack';

const app = new App();

new BudgetStack(app, 'Budget', {
  env: {
    account: process.env.CDK_DEFAULT_ACCOUNT,
    region: process.env.CDK_DEFAULT_REGION ?? 'eu-north-1',
  },
});
