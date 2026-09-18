# Explicit Lambda log groups with retention (LOG-05). Custom names avoid
# colliding with the auto-created /aws/lambda/* groups of existing deployments.
locals {
  lambda_log_retention_days = 14
}

resource "aws_cloudwatch_log_group" "static_lambda" {
  name              = "/${var.app_name}/lambda/static"
  retention_in_days = local.lambda_log_retention_days

  tags = {
    Environment = var.environment
    ManagedBy   = "OpenTofu"
  }
}

resource "aws_cloudwatch_log_group" "api_lambda" {
  name              = "/${var.app_name}/lambda/api"
  retention_in_days = local.lambda_log_retention_days

  tags = {
    Environment = var.environment
    ManagedBy   = "OpenTofu"
  }
}

resource "aws_cloudwatch_log_group" "worker_lambda" {
  name              = "/${var.app_name}/lambda/worker"
  retention_in_days = local.lambda_log_retention_days

  tags = {
    Environment = var.environment
    ManagedBy   = "OpenTofu"
  }
}
