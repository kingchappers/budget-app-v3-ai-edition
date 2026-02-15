# Initial Infrastructure Setup

This directory contains OpenTofu/Terraform configuration for bootstrapping the AWS environment. Run this **once** before deploying the main application infrastructure.

## What This Creates

1. **S3 Bucket for Terraform State** - Encrypted, versioned bucket for state storage
2. **GitHub OIDC Provider** - Allows GitHub Actions to authenticate to AWS
3. **IAM Role for GitHub Actions** - Scoped permissions for CI/CD deployments

## Security Features

- ✅ **INFRA-01**: Least privilege IAM permissions scoped to specific resources
- ✅ **INFRA-03**: S3 bucket encryption at rest with AES256
- ✅ **SEC-04**: State encryption and versioning enabled
- ✅ **INFRA-08**: All resources tagged with Environment, ManagedBy, Application
- ✅ OIDC restricted to main branch only (prevents PR/fork abuse)
- ✅ GitHub OIDC thumbprint validation
- ✅ S3 bucket public access blocked
- ✅ 30-day lifecycle policy for old state versions

## Prerequisites

- AWS credentials with permissions to create:
  - IAM roles, policies, and OIDC providers
  - S3 buckets
- OpenTofu or Terraform installed

## Usage

### 1. Configure variables

Edit `terraform.tfvars`:
```hcl
aws_region   = "eu-west-2"
state_bucket = "your-unique-bucket-name"
app_name     = "your-app-name"
environment  = "production"
```

### 2. Initialize backend

```bash
cd infra/initialSetup
tofu init -backend-config=backend.hcl
```

### 3. Review plan

```bash
tofu plan
```

### 4. Apply

```bash
tofu apply
```

### 5. Note the outputs

The apply will output:
- `github_actions_role_arn` - Use this in GitHub Actions workflow
- `oidc_provider_arn` - OIDC provider ARN
- `state_bucket_name` - State bucket name

## GitHub Actions Configuration

The IAM role is configured to trust only the **main branch**. To allow pull requests, modify the OIDC condition in `main.tf`:

```hcl
# Current (main branch only):
values = ["repo:kingchappers/${var.app_name}:ref:refs/heads/main"]

# To allow PRs:
values = [
  "repo:kingchappers/${var.app_name}:ref:refs/heads/main",
  "repo:kingchappers/${var.app_name}:pull_request"
]
```

## Permissions Granted

The GitHub Actions role can:
- Create/update/delete Lambda functions (app-scoped)
- Manage API Gateway resources
- Create CloudWatch log groups
- Manage IAM roles for Lambda execution (app-scoped)
- Read/write to the Terraform state bucket

See `main.tf` for the complete policy document.

## Notes

- This setup should be run **manually** with administrative credentials
- The state for this configuration is stored in the same S3 bucket it creates (bootstrapping)
- After initial setup, manage this infrastructure through version control
- Do not delete the state bucket while infrastructure exists
