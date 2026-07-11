# =============================================================================
# Media_CDN: CloudFront in front of the private s3_media bucket.
#
# Serves venue photos publicly while the bucket stays private. The bucket is
# reached only through Origin Access Control (OAC); the bucket policy grants
# read to the cloudfront.amazonaws.com service principal scoped to THIS
# distribution's ARN (AWS:SourceArn), so no other principal and no public
# access is possible. Pay-per-use, no WAF, no always-on cost (serverless-only).
#
# When no custom_domain is set, the default *.cloudfront.net domain (and its
# managed certificate) serves HTTPS, and media_cdn_url is that domain. When a
# custom_domain + us-east-1 acm_certificate_arn are supplied (prod uses
# cdn.areacode.co.za), the distribution is aliased to that domain, media_cdn_url
# becomes https://<custom_domain>, and the caller owns the DNS alias record.
# CloudFront requires the ACM certificate in us-east-1; the whole prod stack is
# already us-east-1, so no separate provider alias is needed.
# =============================================================================

variable "env" {
  type = string
}

variable "custom_domain" {
  type        = string
  default     = ""
  description = "Optional CNAME/alias for the distribution, e.g. cdn.areacode.co.za. Empty means serve only the default *.cloudfront.net domain."
}

variable "acm_certificate_arn" {
  type        = string
  default     = ""
  description = "ARN of a us-east-1 ACM certificate covering custom_domain. Required (and only used) when custom_domain is set."
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
  origin_id         = "s3-media-${var.env}"
  has_custom_domain = var.custom_domain != ""
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
  aliases     = local.has_custom_domain ? [var.custom_domain] : null

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

  # Default *.cloudfront.net cert unless a custom domain + ACM cert are supplied.
  viewer_certificate {
    cloudfront_default_certificate = local.has_custom_domain ? null : true
    acm_certificate_arn            = local.has_custom_domain ? var.acm_certificate_arn : null
    ssl_support_method             = local.has_custom_domain ? "sni-only" : null
    minimum_protocol_version       = local.has_custom_domain ? "TLSv1.2_2021" : null
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

output "distribution_hosted_zone_id" {
  description = "CloudFront's fixed hosted zone id, for a Route53 alias record to the distribution."
  value       = aws_cloudfront_distribution.media.hosted_zone_id
}

# The public base URL to use as VITE_CDN_URL: the custom domain when aliased,
# otherwise the default *.cloudfront.net domain.
output "media_cdn_url" {
  value = local.has_custom_domain ? "https://${var.custom_domain}" : "https://${aws_cloudfront_distribution.media.domain_name}"
}
