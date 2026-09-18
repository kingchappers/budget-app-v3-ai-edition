# ============================================================================
# Bank worker Lambda: the only component that can read the TrueLayer key
# ============================================================================

locals {
  app_base_url = trimsuffix(var.app_base_url != "" ? var.app_base_url : aws_apigatewayv2_stage.default.invoke_url, "/")
}

data "archive_file" "sync_lambda_zip" {
  type        = "zip"
  source_dir  = "${path.module}/../build/sync"
  output_path = "${path.module}/sync_lambda_function.zip"
}

# SEC-02/SEC-04: created empty; the value is set out-of-band with
# `aws secretsmanager put-secret-value` so the key never enters state.
resource "aws_secretsmanager_secret" "truelayer" {
  name                    = "${var.app_name}/truelayer"
  description             = "TrueLayer clientId, clientSecret and environment for the bank worker"
  recovery_window_in_days = 7

  tags = {
    Environment = var.environment
    ManagedBy   = "OpenTofu"
  }
}

resource "aws_iam_role" "worker_role" {
  name        = "${var.app_name}-bank-worker-role"
  description = "Execution role for the bank worker Lambda"

  assume_role_policy = jsonencode({
    Version = "2012-10-17"
    Statement = [
      {
        Action    = "sts:AssumeRole"
        Effect    = "Allow"
        Principal = { Service = "lambda.amazonaws.com" }
      }
    ]
  })

  tags = {
    Environment = var.environment
    ManagedBy   = "OpenTofu"
  }
}

resource "aws_iam_role_policy_attachment" "worker_basic_execution" {
  policy_arn = "arn:aws:iam::aws:policy/service-role/AWSLambdaBasicExecutionRole"
  role       = aws_iam_role.worker_role.name
}

# INFRA-01: table and single secret only
resource "aws_iam_role_policy" "worker_permissions" {
  name = "${var.app_name}-bank-worker-permissions"
  role = aws_iam_role.worker_role.id

  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [
      {
        Effect = "Allow"
        Action = [
          "dynamodb:GetItem",
          "dynamodb:PutItem",
          "dynamodb:UpdateItem",
          "dynamodb:DeleteItem",
          "dynamodb:Query",
          "dynamodb:BatchGetItem",
          "dynamodb:BatchWriteItem",
          "dynamodb:ConditionCheckItem",
        ]
        Resource = aws_dynamodb_table.budget_data.arn
      },
      {
        Effect   = "Allow"
        Action   = ["secretsmanager:GetSecretValue"]
        Resource = aws_secretsmanager_secret.truelayer.arn
      }
    ]
  })
}

resource "aws_lambda_function" "worker" {
  filename         = data.archive_file.sync_lambda_zip.output_path
  function_name    = "${var.app_name}-bank-worker"
  role             = aws_iam_role.worker_role.arn
  handler          = "index.handler"
  runtime          = "nodejs24.x"
  timeout          = 300
  memory_size      = 256
  source_code_hash = data.archive_file.sync_lambda_zip.output_base64sha256

  environment {
    variables = {
      NODE_ENV       = "production"
      DYNAMODB_TABLE = aws_dynamodb_table.budget_data.name
      TL_SECRET_ID   = aws_secretsmanager_secret.truelayer.name
      APP_BASE_URL   = local.app_base_url
    }
  }

  logging_config {
    log_format = "Text"
    log_group  = aws_cloudwatch_log_group.worker_lambda.name
  }

  tags = {
    Environment = var.environment
    ManagedBy   = "OpenTofu"
  }
}

# INFRA-04: no automatic retries; the next schedule is the retry and the lock prevents overlap
resource "aws_lambda_function_event_invoke_config" "worker" {
  function_name          = aws_lambda_function.worker.function_name
  maximum_retry_attempts = 0
}

resource "aws_cloudwatch_event_rule" "bank_sync_schedule" {
  name                = "${var.app_name}-bank-sync"
  description         = "Scheduled bank transaction sync"
  schedule_expression = "rate(6 hours)"

  tags = {
    Environment = var.environment
    ManagedBy   = "OpenTofu"
  }
}

resource "aws_cloudwatch_event_target" "bank_sync_worker" {
  rule = aws_cloudwatch_event_rule.bank_sync_schedule.name
  arn  = aws_lambda_function.worker.arn
}

# INFRA-02: only this rule may invoke the worker via EventBridge
resource "aws_lambda_permission" "eventbridge_worker" {
  statement_id  = "AllowEventBridgeBankSync"
  action        = "lambda:InvokeFunction"
  function_name = aws_lambda_function.worker.function_name
  principal     = "events.amazonaws.com"
  source_arn    = aws_cloudwatch_event_rule.bank_sync_schedule.arn
}

# The API Lambda may invoke only the worker
resource "aws_iam_role_policy" "api_invoke_worker" {
  name = "${var.app_name}-api-invoke-worker"
  role = aws_iam_role.api_role.id

  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [
      {
        Effect   = "Allow"
        Action   = ["lambda:InvokeFunction"]
        Resource = aws_lambda_function.worker.arn
      }
    ]
  })
}

output "truelayer_secret_name" {
  value       = aws_secretsmanager_secret.truelayer.name
  description = "Set with: aws secretsmanager put-secret-value --secret-id <name> --secret-string file://truelayer-secret.json"
}

output "bank_redirect_url" {
  value       = "${local.app_base_url}/banks/callback"
  description = "Register this redirect URL in the TrueLayer console"
}
