#!/usr/bin/env node
import { App } from 'aws-cdk-lib';
import { BudgetStack } from '../lib/budget-stack';
import { CiStack } from '../lib/ci-stack';

const app = new App();

const env = {
  account: process.env.CDK_DEFAULT_ACCOUNT,
  region: process.env.CDK_DEFAULT_REGION ?? 'eu-north-1',
};

new BudgetStack(app, 'Budget', { env });

new CiStack(app, 'BudgetCi', {
  env,
  repository: 'ganhammar/budget',
  branch: 'main',
});
