# ============================================================================
# Bill reminder scheduler: opt-in push notifications
#
# Runs once an hour. Each run reads the index of people who have turned
# reminders on, and only looks further at devices whose own clock has reached
# the hour they chose. Until a VAPID key pair exists (see the SSM parameter and
# GitHub secret named in the pull request), every run finds nothing to do.
# ============================================================================

locals {
  # Created by hand as a SecureString (SEC-01): the private key never appears in this repository or in state.
  vapid_private_key_parameter = "/budget-app/vapid-private-key"
}

# Scheduler execution role (INFRA-01): its own table access, and one parameter
resource "aws_iam_role" "push_role" {
  name        = "${var.app_name}-push-role"
  description = "Execution role for the bill reminder scheduler Lambda"

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

resource "aws_iam_role_policy_attachment" "push_basic_execution" {
  policy_arn = "arn:aws:iam::aws:policy/service-role/AWSLambdaBasicExecutionRole"
  role       = aws_iam_role.push_role.name
}

# It reads subscribers, bills and entries, and removes a subscription the push
# service reports as gone. It never writes anything else (INFRA-01).
resource "aws_iam_role_policy" "push_dynamodb" {
  name = "${var.app_name}-push-dynamodb"
  role = aws_iam_role.push_role.id

  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [
      {
        Effect = "Allow"
        Action = [
          "dynamodb:Query",
          "dynamodb:GetItem",
          "dynamodb:DeleteItem",
        ]
        Resource = aws_dynamodb_table.budget_data.arn
      }
    ]
  })
}

# The VAPID private key, and only that parameter (INFRA-01)
resource "aws_iam_role_policy" "push_ssm" {
  name = "${var.app_name}-push-ssm"
  role = aws_iam_role.push_role.id

  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [
      {
        Effect   = "Allow"
        Action   = ["ssm:GetParameter"]
        Resource = "arn:aws:ssm:${var.aws_region}:${data.aws_caller_identity.current.account_id}:parameter${local.vapid_private_key_parameter}"
      }
    ]
  })
}

data "archive_file" "push_lambda_zip" {
  type        = "zip"
  source_dir  = "${path.module}/../build/push"
  output_path = "${path.module}/push_lambda_function.zip"
}

resource "aws_lambda_function" "push" {
  filename         = data.archive_file.push_lambda_zip.output_path
  function_name    = "${var.app_name}-push"
  role             = aws_iam_role.push_role.arn
  handler          = "index.handler"
  runtime          = "nodejs24.x"
  timeout          = 120
  memory_size      = 256
  source_code_hash = data.archive_file.push_lambda_zip.output_base64sha256

  environment {
    variables = {
      NODE_ENV                    = "production"
      DYNAMODB_TABLE              = aws_dynamodb_table.budget_data.name
      VAPID_PUBLIC_KEY            = var.vapid_public_key
      VAPID_SUBJECT               = var.vapid_subject
      VAPID_PRIVATE_KEY_PARAMETER = local.vapid_private_key_parameter
    }
  }

  logging_config {
    log_format = "Text"
    log_group  = aws_cloudwatch_log_group.push_lambda.name
  }

  tags = {
    Environment = var.environment
    ManagedBy   = "OpenTofu"
  }
}

# On the hour, every hour: a person chooses the hour in their own time zone.
resource "aws_cloudwatch_event_rule" "push_hourly" {
  name                = "${var.app_name}-push-hourly"
  description         = "Runs the bill reminder scheduler on the hour"
  schedule_expression = "cron(0 * * * ? *)"

  tags = {
    Environment = var.environment
    ManagedBy   = "OpenTofu"
  }
}

resource "aws_cloudwatch_event_target" "push_hourly" {
  rule = aws_cloudwatch_event_rule.push_hourly.name
  arn  = aws_lambda_function.push.arn
}

# Only this rule may invoke the scheduler (INFRA-02)
resource "aws_lambda_permission" "push_eventbridge" {
  statement_id  = "AllowEventBridgeInvokePush"
  action        = "lambda:InvokeFunction"
  function_name = aws_lambda_function.push.function_name
  principal     = "events.amazonaws.com"
  source_arn    = aws_cloudwatch_event_rule.push_hourly.arn
}
