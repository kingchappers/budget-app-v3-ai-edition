terraform {
  required_providers {
    aws = {
      source  = "hashicorp/aws"
      version = "~> 6.0"
    }
  }

  # Backend configuration should be provided via backend.hcl file or CLI flags
  # Example: tofu init -backend-config=backend.hcl
  # backend.hcl should contain:
  #   bucket       = "your-state-bucket"
  #   key          = "budget-app/terraform.tfstate"
  #   region       = "eu-west-2"
  #   use_lockfile = true
  backend "s3" {}
}

provider "aws" {
  region = var.aws_region
}
