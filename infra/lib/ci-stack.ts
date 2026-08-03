import { Stack, StackProps, CfnOutput } from 'aws-cdk-lib';
import * as iam from 'aws-cdk-lib/aws-iam';
import { Construct } from 'constructs';

export interface CiStackProps extends StackProps {
  /** owner/repo, e.g. "ganhammar/budget". */
  readonly repository: string;
  /** Only this branch may assume the role. */
  readonly branch?: string;
}

/**
 * The role GitHub Actions assumes to deploy. Kept out of the application stack so
 * CI identity is not coupled to application resources.
 */
export class CiStack extends Stack {
  constructor(scope: Construct, id: string, props: CiStackProps) {
    super(scope, id, props);

    const branch = props.branch ?? 'main';

    // The provider is account-wide and already exists, so it is imported rather
    // than created; a second one for the same issuer would fail.
    const provider = iam.OpenIdConnectProvider.fromOpenIdConnectProviderArn(
      this,
      'GitHubOidc',
      `arn:aws:iam::${this.account}:oidc-provider/token.actions.githubusercontent.com`,
    );

    const role = new iam.Role(this, 'DeployRole', {
      roleName: 'budget-github-deploy',
      description: `Deploys the Budget stack from ${props.repository}`,
      maxSessionDuration: undefined,
      assumedBy: new iam.WebIdentityPrincipal(provider.openIdConnectProviderArn, {
        StringEquals: {
          'token.actions.githubusercontent.com:aud': 'sts.amazonaws.com',
          // Pinned to one branch on purpose. The repository is public, so anyone
          // can open a pull request; a wildcard subject would hand them the role.
          'token.actions.githubusercontent.com:sub': `repo:${props.repository}:ref:refs/heads/${branch}`,
        },
      }),
    });

    // CDK does its own privilege separation through the bootstrap roles, so the
    // deploy identity only needs permission to assume those.
    role.addToPolicy(
      new iam.PolicyStatement({
        actions: ['sts:AssumeRole'],
        resources: [`arn:aws:iam::${this.account}:role/cdk-*`],
      }),
    );

    new CfnOutput(this, 'DeployRoleArn', { value: role.roleArn });
  }
}
