# Shared backend configuration.
# The S3 bucket and DynamoDB table are created by infra/bootstrap/main.tf.
# Run bootstrap first before using this configuration.

terraform {
  backend "s3" {
    bucket         = "area-code-terraform-state"
    key            = "shared/terraform.tfstate"
    region         = "us-east-1"
    dynamodb_table = "area-code-terraform-locks"
    encrypt        = true
  }
}
