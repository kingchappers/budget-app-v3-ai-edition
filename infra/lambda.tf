# Lambda execution role
resource "aws_iam_role" "lambda_role" {
  name = "${var.app_name}-lambda-role"
  
  assume_role_policy = jsonencode({
    Version = "2012-10-17"
    Statement = [
      {
        Action = "sts:AssumeRole"
        Effect = "Allow"
        Principal = {
          Service = "lambda.amazonaws.com"
        }
      }
    ]
  })
  # Explicit attributes to match provider planned/defaults and avoid
  # legacy-plugin SDK warnings about non-computed attributes appearing
  description          = "Role for the Lambda function of the auth-starter-app"
  max_session_duration = 3600
  force_detach_policies = false
  path                 = "/"
  permissions_boundary = ""
  tags                 = {}
}

# Attach basic Lambda execution policy
resource "aws_iam_role_policy_attachment" "lambda_basic_execution" {
  policy_arn = "arn:aws:iam::aws:policy/service-role/AWSLambdaBasicExecutionRole"
  role       = aws_iam_role.lambda_role.name
}

# Archive the build output
data "archive_file" "lambda_zip" {
  type        = "zip"
  source_dir  = "${path.module}/../build/client"
  output_path = "${path.module}/lambda_function.zip"
}

# Lambda function
resource "aws_lambda_function" "app" {
  filename         = data.archive_file.lambda_zip.output_path
  function_name    = var.app_name
  role             = aws_iam_role.lambda_role.arn
  handler          = "index.handler"
  runtime          = "nodejs24.x"
  timeout          = 30
  memory_size      = 512
  source_code_hash = data.archive_file.lambda_zip.output_base64sha256

  environment {
    variables = {
      NODE_ENV             = "production"
      VITE_AUTH0_DOMAIN    = var.auth0_domain
      VITE_AUTH0_CLIENT_ID = var.auth0_client_id
    }
  }

  tags = {
    Environment = var.environment
    ManagedBy   = "OpenTofu"
  }
}

# API Gateway REST API
resource "aws_apigatewayv2_api" "app" {
  name          = "${var.app_name}-api"
  description = "API for the authentication starter application"
  protocol_type = "HTTP"

  cors_configuration {
    allow_origins  = ["*"]
    allow_methods  = ["GET", "HEAD", "OPTIONS", "POST", "PUT", "PATCH", "DELETE"]
    allow_headers  = ["*"]
    expose_headers = ["*"]
    max_age        = 300
  }

  api_key_selection_expression = "$request.header.x-api-key"
  version = 0.1

  tags = {
    Environment = var.environment
  }
}

# Integration between API Gateway and Lambda
resource "aws_apigatewayv2_integration" "lambda" {
  api_id                 = aws_apigatewayv2_api.app.id
  integration_type       = "AWS_PROXY"
  integration_method     = "POST"
  payload_format_version = "2.0"
  integration_uri        = aws_lambda_function.app.invoke_arn
  description            = "Lambda integration for ${var.app_name}"
}

# Route all requests to Lambda
resource "aws_apigatewayv2_route" "default" {
  api_id    = aws_apigatewayv2_api.app.id
  route_key = "$default"
  target    = "integrations/${aws_apigatewayv2_integration.lambda.id}"
}

# Stage (deployment)
resource "aws_apigatewayv2_stage" "default" {
  api_id      = aws_apigatewayv2_api.app.id
  name        = "$default"
  auto_deploy = true

  access_log_settings {
    destination_arn = aws_cloudwatch_log_group.api_logs.arn
    format          = "$context.requestId"
  }

  tags = {
    Environment = var.environment
  }
}

# CloudWatch logs for API Gateway
resource "aws_cloudwatch_log_group" "api_logs" {
  name              = "/aws/apigateway/${var.app_name}"
  retention_in_days = 7

  tags = {
    Environment = var.environment
  }
}

# Grant API Gateway permission to create log streams and put log events
# into the `api_logs` log group. Without this resource policy API Gateway
# may fail with "Insufficient permissions to enable logging" when creating
# the $default stage.
resource "aws_cloudwatch_log_resource_policy" "apigateway_write" {
  policy_name = "APIGatewayPushToCloudWatchLogs-${var.app_name}"

  policy_document = jsonencode({
    Version = "2012-10-17",
    Statement = [
      {
        Effect = "Allow",
        Principal = { Service = "apigateway.amazonaws.com" },
        Action = [
          "logs:CreateLogStream",
          "logs:PutLogEvents",
          "logs:CreateLogGroup"
        ],
        Resource = "${aws_cloudwatch_log_group.api_logs.arn}:*"
      }
    ]
  })
}

# Lambda permission to be invoked by API Gateway
resource "aws_lambda_permission" "api_gateway" {
  statement_id  = "AllowAPIGatewayInvoke"
  action        = "lambda:InvokeFunction"
  function_name = aws_lambda_function.app.function_name
  principal     = "apigateway.amazonaws.com"
  source_arn    = "${aws_apigatewayv2_api.app.execution_arn}/*/*"
}

# Outputs
data "aws_caller_identity" "current" {}
data "aws_region" "current" {}

output "api_endpoint" {
  value       = aws_apigatewayv2_stage.default.invoke_url
  description = "API Gateway endpoint URL"
}

####################################################################
#### NEXT STEPS:  ##################################################
######## 1. Create a CI/CD pipeline to build the react package to auth-app/build #
######## 2. Set auth0_domain and auth0_client_id variables as secrets in AWS and collected by the pipeline #
####################################################################

### API Gateway CloudWatch role (conditional)
# Create the role only when `var.create_apigw_cloudwatch_role` is true.
resource "aws_iam_role" "apigateway_cloudwatch_role" {
  name = "${var.app_name}-apigw-cw-logs-role"

  assume_role_policy = jsonencode({
    Version = "2012-10-17",
    Statement = [
      {
        Effect = "Allow",
        Principal = {
          Service = "apigateway.amazonaws.com"
        },
        Action = "sts:AssumeRole"
      }
    ]
  })
}

resource "aws_iam_role_policy_attachment" "apigateway_push_logs" {
  role       = aws_iam_role.apigateway_cloudwatch_role.name
  policy_arn = "arn:aws:iam::aws:policy/service-role/AmazonAPIGatewayPushToCloudWatchLogs"
}

# Configure API Gateway account to use either the created role ARN or an
# existing role ARN supplied in `var.apigw_cloudwatch_role_arn`.
resource "aws_api_gateway_account" "account" {
  cloudwatch_role_arn = aws_iam_role.apigateway_cloudwatch_role.arn
}

data "aws_iam_policy_document" "apiGateway_iam_policy_document" {
  statement {
    actions = [
      "apigateway:GET",
      "apigateway:UpdateAccount",
      "iam:GetRole",
      "iam:PassRole"
    ]
    effect    = "Allow"
    resources = ["*"]
  }
}

resource "aws_iam_policy" "apiGateway_iam_policy" {
  name        = "apiGateway-iam-policy"
  description = "A policy to allow API Gateway to access AWS resources for the auth-app project."
  policy      = data.aws_iam_policy_document.apiGateway_iam_policy_document.json
}

resource "aws_iam_role_policy_attachment" "apiGateway_role_policy_attach" {
  role       = aws_iam_role.apigateway_cloudwatch_role.name
  policy_arn = aws_iam_policy.apiGateway_iam_policy.arn
}