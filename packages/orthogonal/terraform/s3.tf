resource "aws_s3_bucket" "s3_bucket" {
  bucket = "pennsieve-${var.environment_name}-${var.service_name}-${data.terraform_remote_state.region.outputs.aws_region_shortname}"

  lifecycle {
    prevent_destroy = true
  }

  tags = merge(
    local.common_tags,
    {
      "Name" = "${var.environment_name}-${var.service_name}-s3-bucket-${data.terraform_remote_state.region.outputs.aws_region_shortname}"
      "name" = "${var.environment_name}-${var.service_name}-s3-bucket-${data.terraform_remote_state.region.outputs.aws_region_shortname}"
      "tier" = "s3"
    },
  )
}

resource "aws_s3_bucket_website_configuration" "s3_bucket_website" {
  bucket = aws_s3_bucket.s3_bucket.bucket

  index_document {
    suffix = "embed.html"
  }

  error_document {
    key = "embed.html"
  }
}

resource "aws_s3_bucket_policy" "s3_bucket_policy" {
  bucket = aws_s3_bucket.s3_bucket.bucket
  policy = data.aws_iam_policy_document.iam_policy_document.json
}

resource "aws_s3_bucket_server_side_encryption_configuration" "s3_bucket_encryption" {
  bucket = aws_s3_bucket.s3_bucket.bucket

  rule {
    apply_server_side_encryption_by_default {
      sse_algorithm = "AES256"
    }
  }
}

resource "aws_s3_bucket_logging" "s3_logging" {
  bucket = aws_s3_bucket.s3_bucket.id

  target_bucket = data.terraform_remote_state.region.outputs.logs_s3_bucket_id
  target_prefix = "${var.environment_name}/${var.service_name}/s3/"
}
