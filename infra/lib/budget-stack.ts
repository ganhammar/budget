import * as path from 'node:path';
import {
  Stack,
  StackProps,
  RemovalPolicy,
  Duration,
  CfnOutput,
} from 'aws-cdk-lib';
import * as dynamodb from 'aws-cdk-lib/aws-dynamodb';
import * as lambda from 'aws-cdk-lib/aws-lambda';
import * as s3 from 'aws-cdk-lib/aws-s3';
import * as s3deploy from 'aws-cdk-lib/aws-s3-deployment';
import * as cloudfront from 'aws-cdk-lib/aws-cloudfront';
import * as origins from 'aws-cdk-lib/aws-cloudfront-origins';
import * as apigw from 'aws-cdk-lib/aws-apigatewayv2';
import * as integrations from 'aws-cdk-lib/aws-apigatewayv2-integrations';
import * as secretsmanager from 'aws-cdk-lib/aws-secretsmanager';
import * as acm from 'aws-cdk-lib/aws-certificatemanager';
import { Construct } from 'constructs';

const ROOT = path.join(__dirname, '..', '..');

const SITE_DOMAIN = process.env.SITE_DOMAIN ?? 'budget.ganhammar.se';

// CloudFront only accepts certificates from us-east-1 regardless of stack region.
// DNS lives in Cloudflare, so this was requested and validated by hand rather than
// created by CDK, and is imported by ARN.
const CERTIFICATE_ARN =
  process.env.CERTIFICATE_ARN ??
  'arn:aws:acm:us-east-1:519157272275:certificate/aada0efe-f233-42da-8326-54c5135b7527';

export class BudgetStack extends Stack {
  constructor(scope: Construct, id: string, props?: StackProps) {
    super(scope, id, props);

    /* ---------- Data ---------- */

    const table = new dynamodb.TableV2(this, 'Table', {
      partitionKey: { name: 'pk', type: dynamodb.AttributeType.STRING },
      sortKey: { name: 'sk', type: dynamodb.AttributeType.STRING },
      billing: dynamodb.Billing.onDemand(),
      pointInTimeRecoverySpecification: { pointInTimeRecoveryEnabled: true },
      // Household finances: losing the table to a stack delete would be unrecoverable.
      removalPolicy: RemovalPolicy.RETAIN,
    });

    /* ---------- API ---------- */

    // Signs the session cookie. Generated once and never in the template, so
    // rotating it is a matter of changing the secret rather than redeploying code.
    const sessionSecret = new secretsmanager.Secret(this, 'SessionSecret', {
      description: 'HMAC key for Budget session cookies',
      generateSecretString: {
        passwordLength: 64,
        excludePunctuation: true,
      },
      removalPolicy: RemovalPolicy.RETAIN,
    });

    const googleClientId = process.env.GOOGLE_CLIENT_ID;
    if (!googleClientId) {
      throw new Error('GOOGLE_CLIENT_ID must be set to synthesize the API');
    }

    const api = new lambda.Function(this, 'Api', {
      // Custom runtime, zip payload. The executable is named `bootstrap`.
      runtime: lambda.Runtime.PROVIDED_AL2023,
      architecture: lambda.Architecture.ARM_64,
      handler: 'bootstrap',
      code: lambda.Code.fromAsset(path.join(ROOT, 'api', 'publish')),
      memorySize: 512,
      timeout: Duration.seconds(20),
      environment: {
        TABLE_NAME: table.tableName,
        GOOGLE_CLIENT_ID: googleClientId,
        SESSION_SECRET_ARN: sessionSecret.secretArn,
      },
    });

    table.grantReadWriteData(api);
    sessionSecret.grantRead(api);

    // A Lambda function URL behind CloudFront OAC looks tempting, but OAC signs the
    // request without the body, so every POST/PUT fails SigV4 validation with a 403.
    // HTTP API has no such problem and costs about a dollar per million requests.
    const httpApi = new apigw.HttpApi(this, 'HttpApi', {
      defaultIntegration: new integrations.HttpLambdaIntegration('ApiIntegration', api),
    });

    const apiDomain = `${httpApi.apiId}.execute-api.${this.region}.${this.urlSuffix}`;

    /* ---------- Web ---------- */

    const site = new s3.Bucket(this, 'Site', {
      blockPublicAccess: s3.BlockPublicAccess.BLOCK_ALL,
      encryption: s3.BucketEncryption.S3_MANAGED,
      enforceSSL: true,
      removalPolicy: RemovalPolicy.DESTROY,
      autoDeleteObjects: true,
    });

    const distribution = new cloudfront.Distribution(this, 'Distribution', {
      domainNames: [SITE_DOMAIN],
      certificate: acm.Certificate.fromCertificateArn(this, 'Certificate', CERTIFICATE_ARN),
      defaultRootObject: 'index.html',
      defaultBehavior: {
        origin: origins.S3BucketOrigin.withOriginAccessControl(site),
        viewerProtocolPolicy: cloudfront.ViewerProtocolPolicy.REDIRECT_TO_HTTPS,
        cachePolicy: cloudfront.CachePolicy.CACHING_OPTIMIZED,
      },
      additionalBehaviors: {
        // Same origin as the app, so the session cookie needs no CORS or SameSite=None.
        'api/*': {
          origin: new origins.HttpOrigin(apiDomain),
          viewerProtocolPolicy: cloudfront.ViewerProtocolPolicy.REDIRECT_TO_HTTPS,
          allowedMethods: cloudfront.AllowedMethods.ALLOW_ALL,
          cachePolicy: cloudfront.CachePolicy.CACHING_DISABLED,
          originRequestPolicy: cloudfront.OriginRequestPolicy.ALL_VIEWER_EXCEPT_HOST_HEADER,
        },
      },
      // No SPA error-page fallback on purpose. The app routes on the hash, so there
      // are no deep paths to rewrite, and a distribution-wide rule would silently
      // turn genuine API 403s and 404s into a 200 page of HTML.
    });

    new s3deploy.BucketDeployment(this, 'DeploySite', {
      sources: [s3deploy.Source.asset(path.join(ROOT, 'web', 'dist'))],
      destinationBucket: site,
      distribution,
      distributionPaths: ['/*'],
    });

    new CfnOutput(this, 'SiteUrl', { value: `https://${distribution.distributionDomainName}` });
    new CfnOutput(this, 'TableName', { value: table.tableName });
    new CfnOutput(this, 'ApiFunctionName', { value: api.functionName });
  }
}
