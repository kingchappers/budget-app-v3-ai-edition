terraform {
  required_providers {
    aws = {
      source  = "hashicorp/aws"
      version = "~> 6.0"
    }
  }

  backend "s3" {
    bucket       = var.state_bucket
    key          = "${var.app_name}-infra-setup/terraform.tfstate"
    region       = var.aws_region
    use_lockfile = true
  }
}

provider "aws" {
  region = var.aws_region
}

data "aws_iam_policy_document" "assume_role" {
  statement {
    actions = [
      "sts:AssumeRoleWithWebIdentity",
    ]
    effect = "Allow"

    principals {
      type        = "Federated"
      identifiers = [aws_iam_openid_connect_provider.github_actions.arn]
    }

    condition {
      test     = "StringLike"
      variable = "token.actions.githubusercontent.com:sub"
      # Allow workflows from this repo (branches and PRs). Tighten if you only
      # want a specific branch (e.g. ref:refs/heads/main).
      values = ["repo:kingchappers/${var.app_name}:*"]
    }

    condition {
      test     = "StringEquals"
      variable = "token.actions.githubusercontent.com:aud"
      values   = ["sts.amazonaws.com"]
    }
  }
}

data "aws_iam_policy_document" "github_iam_policy_document" {
  statement {
    actions = [
      "apigateway:GET",
      "apigateway:UpdateAccount",
      "apigateway:POST",
      "apigateway:PATCH",
      "apigateway:TagResource",
      "iam:AttachRolePolicy",
      "iam:CreateRole",
      "iam:DeleteRolePolicy",
      "iam:DetachRolePolicy",
      "iam:GetRole",
      "iam:ListAttachedRolePolicies",
      "iam:ListRolePolicies",
      "iam:PassRole",
      "iam:PutRolePolicy",
      "iam:CreatePolicy",
      "iam:GetPolicy",
      "iam:GetPolicyVersion",
      "iam:DeletePolicy",
      "iam:ListPolicyVersions",
      "iam:CreateServiceLinkedRole",
      "iam:ListInstanceProfilesForRole",
      "iam:UpdateRoleDescription",
      "iam:UpdateRoleDescription",
      "lambda:CreateFunction",
      "lambda:DeleteFunction",
      "lambda:UpdateFunction",
      "lambda:GetFunction",
      "lambda:GetPolicy",
      "lambda:UpdateFunctionConfiguration",
      "lambda:TagResource",
      "lambda:ListVersionsByFunction",
      "lambda:GetFunctionCodeSigningConfig",
      "lambda:AddPermission",
      "lambda:RemovePermission",
      "lambda:UpdateFunctionCode",
      "logs:CreateLogGroup",
      "logs:CreateLogDelivery",
      "logs:CreateLogStream",
      "logs:DeleteLogGroup",
      "logs:DeleteRetentionPolicy",
      "logs:DescribeLogGroups",
      "logs:DescribeLogStreams",
      "logs:ListTagsForResource",
      "logs:PutRetentionPolicy",
      "logs:PutLogEvents",
      "logs:GetLogEvents",
      "logs:FilterLogEvents",
      "logs:TagResource",
      "logs:PutResourcePolicy",
      "logs:DescribeResourcePolicies",
      "logs:DeleteResourcePolicy",
      "s3:CreateBucket",
      "s3:DeleteBucket",
      "s3:DeleteObject",
      "s3:GetObject",
      "s3:PutObject",
      "s3:ListBucket",
      "s3:HeadObject"
    ]
    effect    = "Allow"
    resources = ["*"]
  }
}

resource "aws_iam_policy" "github_actions_iam_policy" {
  name        = "github-actions-iam-policy"
  description = "A policy to allow GitHub Actions to deploy to AWS for the auth-app project."
  policy      = data.aws_iam_policy_document.github_iam_policy_document.json
}

resource "aws_iam_openid_connect_provider" "github_actions" {
  url            = "https://token.actions.githubusercontent.com"
  client_id_list = ["sts.amazonaws.com"]
}

resource "aws_iam_role" "github_actions_role" {
  name               = "github-actions"
  assume_role_policy = data.aws_iam_policy_document.assume_role.json
}

resource "aws_iam_role_policy_attachment" "github_actions_role_policy_attach" {
  role       = aws_iam_role.github_actions_role.name
  policy_arn = aws_iam_policy.github_actions_iam_policy.arn
}
