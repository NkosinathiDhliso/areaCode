# =============================================================================
# Media_CDN: CloudFront in front of the private s3_media bucket.
#
# Serves venue photos publicly while the bucket stays private. The bucket is
# reached only through Origin Access Control (OAC); the bucket policy grants
# read to the cloudfront.amazonaws.com service principal scoped to THIS
# distribution's ARN (AWS:SourceArn), so no other principal and no public
# access is possible. Pay-per-use, no WAF, no always-on cost (serverless-only).
#
# The default *.cloudfront.net domain name is output as media_cdn_url and used
# as VITE_CDN_URL. A media.areacode.co.za alias can be added later without any
# code change (add aliases + viewer_certificate).
# =============================================================================

variable "env" {
  type = string
}

variable "bucket_id" {
  type        = string
  description = "The s3_media bucket id, for the bucket policy attachment."
}

variable "bucket_arn" {
  type        = string
  description = "The s3_media bucket ARN, for the bucket policy resource scope."
}

variable "bucket_regional_domain_name" {
  type        = string
  description = "The s3_media bucket regional domain name, the CloudFront origin."
}

locals {
  origin_id = "s3-media-${var.env}"
}

# AWS managed cache policy. It honours the origin's Cache-Control header
# (the long-lived `public, max-age=31536000` set by image-service.ts) and
# enables gzip/brotli so `compress = true` on the behaviour takes effect.
data "aws_cloudfront_cache_policy" "caching_optimized" {
  name = "Managed-CachingOptimized"
}

resource "aws_cloudfront_origin_access_control" "media" {
  name                              = "area-code-${var.env}-media-oac"
  description                       = "OAC for the ${var.env} media bucket"
  origin_access_control_origin_type = "s3"
  signing_behavior                  = "always"
  signing_protocol                  = "sigv4"
}

resource "aws_cloudfront_distribution" "media" {
  enabled     = true
  comment     = "area-code-${var.env} media CDN"
  price_class = "PriceClass_100"

  origin {
    domain_name              = var.bucket_regional_domain_name
    origin_id                = local.origin_id
    origin_access_control_id = aws_cloudfront_origin_access_control.media.id
  }

  default_cache_behavior {
    target_origin_id       = local.origin_id
    viewer_protocol_policy = "redirect-to-https"
    allowed_methods        = ["GET", "HEAD"]
    cached_methods         = ["GET", "HEAD"]
    compress               = true
    cache_policy_id        = data.aws_cloudfront_cache_policy.caching_optimized.id
  }

  restrictions {
    geo_restriction {
      restriction_type = "none"
    }
  }

  # No custom domain yet; the default *.cloudfront.net cert serves HTTPS.
  viewer_certificate {
    cloudfront_default_certificate = true
  }
}

# Bucket stays private: only this distribution may read objects.
data "aws_iam_policy_document" "media_bucket" {
  statement {
    sid       = "AllowCloudFrontServicePrincipalReadOnly"
    effect    = "Allow"
    actions   = ["s3:GetObject"]
    resources = ["${var.bucket_arn}/*"]

    principals {
      type        = "Service"
      identifiers = ["cloudfront.amazonaws.com"]
    }

    condition {
      test     = "StringEquals"
      variable = "AWS:SourceArn"
      values   = [aws_cloudfront_distribution.media.arn]
    }
  }
}

resource "aws_s3_bucket_policy" "media" {
  bucket = var.bucket_id
  policy = data.aws_iam_policy_document.media_bucket.json
}

output "distribution_id" {
  value = aws_cloudfront_distribution.media.id
}

output "distribution_domain_name" {
  value = aws_cloudfront_distribution.media.domain_name
}

output "media_cdn_url" {
  value = "https://${aws_cloudfront_distribution.media.domain_name}"
}
