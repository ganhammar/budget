#!/usr/bin/env node
import { App } from 'aws-cdk-lib';
import { BudgetStack } from '../lib/budget-stack';
import { CertificateStack } from '../lib/certificate-stack';

const app = new App();

const account = process.env.CDK_DEFAULT_ACCOUNT;
const region = process.env.CDK_DEFAULT_REGION ?? 'eu-north-1';
const appDomain = process.env.APP_DOMAIN ?? 'pnkt.app';

// CloudFront reads certificates from us-east-1 only, so this one stack is pinned
// there and its ARN is passed across regions.
const certificates = new CertificateStack(app, 'BudgetCertificates', {
  env: { account, region: 'us-east-1' },
  crossRegionReferences: true,
  domain: appDomain,
});

// CI assumes the account's existing GithubDeploy role, so there is no CI stack
// here. Adding a repository to that role's trust policy is a manual step.
new BudgetStack(app, 'Budget', {
  env: { account, region },
  crossRegionReferences: true,
  appDomain,
  appCertificateArn: certificates.certificateArn,
});
