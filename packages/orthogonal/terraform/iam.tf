data "aws_iam_policy_document" "iam_policy_document" {
  statement {
    sid    = "ForceSSLOnlyAccess"
    effect = "Deny"

    resources = [
      "arn:aws:s3:::pennsieve-${var.environment_name}-${var.service_name}-${data.terraform_remote_state.region.outputs.aws_region_shortname}/*",
      "arn:aws:s3:::pennsieve-${var.environment_name}-${var.service_name}-${data.terraform_remote_state.region.outputs.aws_region_shortname}",
    ]

    actions = ["s3:*"]

    principals {
      type = "*"
      identifiers = ["*"]
    }

    condition {
      test     = "Bool"
      values = ["false"]
      variable = "aws:SecureTransport"
    }
  }

  statement {
    actions = ["s3:GetObject"]
    resources = [
      "arn:aws:s3:::pennsieve-${var.environment_name}-${var.service_name}-${data.terraform_remote_state.region.outputs.aws_region_shortname}/*"
    ]

    principals {
      type = "AWS"
      identifiers = [aws_cloudfront_origin_access_identity.cloudfront_origin_access_identity.iam_arn]
    }
  }

  statement {
    actions = ["s3:ListBucket"]
    resources = [
      "arn:aws:s3:::pennsieve-${var.environment_name}-${var.service_name}-${data.terraform_remote_state.region.outputs.aws_region_shortname}"
    ]

    principals {
      type = "AWS"
      identifiers = [aws_cloudfront_origin_access_identity.cloudfront_origin_access_identity.iam_arn]
    }
  }
}
