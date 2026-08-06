import { Stack, StackProps } from 'aws-cdk-lib';
import * as acm from 'aws-cdk-lib/aws-certificatemanager';
import * as route53 from 'aws-cdk-lib/aws-route53';
import { Construct } from 'constructs';

export interface CertificateStackProps extends StackProps {
  /** Apex domain, which must be a public hosted zone in this account. */
  domain: string;
}

/**
 * CloudFront only accepts certificates from us-east-1, so this is a second stack
 * pinned to that region rather than part of the main one.
 *
 * Unlike the hand-made certificate for ganhammar.se, whose DNS lives in
 * Cloudflare, this one validates itself: the zone is in the account, so CDK
 * writes the validation records and the deploy waits for them.
 */
export class CertificateStack extends Stack {
  readonly certificateArn: string;

  constructor(scope: Construct, id: string, props: CertificateStackProps) {
    super(scope, id, props);

    const zone = route53.HostedZone.fromLookup(this, 'Zone', { domainName: props.domain });

    const certificate = new acm.Certificate(this, 'Certificate', {
      domainName: props.domain,
      subjectAlternativeNames: [`www.${props.domain}`],
      validation: acm.CertificateValidation.fromDns(zone),
    });

    this.certificateArn = certificate.certificateArn;
  }
}
