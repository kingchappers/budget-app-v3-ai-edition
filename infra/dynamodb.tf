# DynamoDB table — single-table design
# PK: USER#{auth0_sub}, SK: entity-prefix#id
resource "aws_dynamodb_table" "budget_data" {
  name         = "${var.app_name}-data"
  billing_mode = "PAY_PER_REQUEST"
  hash_key     = "PK"
  range_key    = "SK"

  attribute {
    name = "PK"
    type = "S"
  }

  attribute {
    name = "SK"
    type = "S"
  }

  point_in_time_recovery {
    enabled = true
  }

  ttl {
    attribute_name = "expiresAt"
    enabled        = true
  }

  # INFRA-03: AWS-managed KMS key; key usage is visible in CloudTrail
  server_side_encryption {
    enabled = true
  }

  tags = {
    Environment = var.environment
    ManagedBy   = "OpenTofu"
    Application = var.app_name
  }
}

moved {
  from = aws_iam_role_policy.lambda_dynamodb
  to   = aws_iam_role_policy.api_dynamodb
}

# IAM policy granting the API Lambda role least-privilege DynamoDB access (INFRA-01)
resource "aws_iam_role_policy" "api_dynamodb" {
  name = "${var.app_name}-api-dynamodb"
  role = aws_iam_role.api_role.id

  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [
      {
        Effect = "Allow"
        Action = [
          "dynamodb:GetItem",
          "dynamodb:PutItem",
          "dynamodb:DeleteItem",
          "dynamodb:Query",
          "dynamodb:UpdateItem",
          "dynamodb:ConditionCheckItem",
        ]
        Resource = aws_dynamodb_table.budget_data.arn
      }
    ]
  })
}

output "dynamodb_table_name" {
  value       = aws_dynamodb_table.budget_data.name
  description = "DynamoDB table name for the budget app data"
}
