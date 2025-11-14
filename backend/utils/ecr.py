"""ECR (Elastic Container Registry) utility functions."""

from typing import Optional, List, Dict, Any


def extract_ecr_info(image_uri):
    """Extract ECR region, account, and repository name from image URI"""
    if not image_uri or ".dkr.ecr." not in image_uri:
        return None, None, None
    
    try:
        # Parse ECR image URI: {account-id}.dkr.ecr.{region}.amazonaws.com/{repository-name}:{tag}
        if ".amazonaws.com/" in image_uri:
            # Extract the ECR part
            ecr_part = image_uri.split(".amazonaws.com/")[0]
            repo_and_tag = image_uri.split(".amazonaws.com/")[1]
            
            # Extract region from ECR part
            if ".dkr.ecr." in ecr_part:
                region_part = ecr_part.split(".dkr.ecr.")[1]
                account_id = ecr_part.split(".dkr.ecr.")[0]
                ecr_region = region_part
                
                # Extract repository name (everything before the tag)
                repo_name = repo_and_tag.split(":")[0]
                
                return ecr_region, account_id, repo_name
    except:
        pass
    
    return None, None, None


def unified_image_comparison(current_image_uri: str, images_info: List[Dict[str, Any]], running_task_digest: Optional[str] = None):
    """Unified logic to determine if updates are available and compute latest image URI.

    Handles both versioned tags and the special "latest" tag in a single place.
    - For versioned tags: compares tags against most recent ECR image's first tag
    - For "latest": compares image digests; prefers the digest from a running task when provided
    """
    try:
        if not current_image_uri or not images_info:
            return False, current_image_uri

        # Ensure newest-first ordering
        try:
            images_info = sorted(images_info, key=lambda x: x.get("imagePushedAt", 0), reverse=True)
        except Exception:
            pass

        base_uri = current_image_uri.split(":")[0]
        current_tag = current_image_uri.split(":")[-1]

        if current_tag == "latest":
            latest_digest = images_info[0].get("imageDigest") if images_info else None

            if running_task_digest:
                has_updates = bool(running_task_digest and latest_digest and running_task_digest != latest_digest)
                return has_updates, f"{base_uri}:latest"

            # Fallback: find the digest currently pointed to by the 'latest' tag in ECR
            current_digest = None
            for img in images_info:
                if "latest" in (img.get("imageTags") or []):
                    current_digest = img.get("imageDigest")
                    break

            if current_digest and latest_digest:
                return current_digest != latest_digest, f"{base_uri}:latest"

            # If we cannot resolve digests, default to no updates
            return False, f"{base_uri}:latest"

        # Versioned tags: compare tag strings to the newest image's first tag
        latest_image = images_info[0]
        latest_tags = latest_image.get("imageTags", [])
        if latest_tags:
            latest_tag = latest_tags[0]
            latest_image_uri = f"{base_uri}:{latest_tag}"
            return current_image_uri != latest_image_uri, latest_image_uri

        return False, current_image_uri
    except Exception:
        # Safe fallback on any unexpected condition
        return False, current_image_uri

