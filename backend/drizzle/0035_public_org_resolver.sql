-- Public routes carry no session, so nothing establishes an organization and
-- every policy correctly refuses them — an applicant could not apply.
--
-- The organization has to come from the resource being addressed. Each lookup
-- must run outside the boundary to find which side of it the request belongs
-- on, so this is SECURITY DEFINER like the login functions, and kept to the
-- same shape: it takes an identifier and returns an id. Never a row.
CREATE OR REPLACE FUNCTION app_resolve_public_org(p_kind text, p_id text)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
STABLE
AS $$
DECLARE
  found integer;
BEGIN
  CASE p_kind
    WHEN 'job' THEN
      SELECT organization_id INTO found FROM jobs WHERE id = p_id::integer;
    WHEN 'job_slug' THEN
      SELECT organization_id INTO found FROM jobs WHERE slug = p_id;
    WHEN 'attempt_token' THEN
      SELECT organization_id INTO found
      FROM candidate_assessment_attempts WHERE token = p_id;
    WHEN 'offer_token' THEN
      SELECT organization_id INTO found FROM offers WHERE review_token = p_id;
    WHEN 'interview_token' THEN
      SELECT organization_id INTO found
      FROM candidate_interviews WHERE public_token = p_id;
    WHEN 'only' THEN
      -- Routes that address no particular resource: the careers listing and
      -- the company profile. Answered by the client company in the URL once
      -- 0001 §7 lands; until then only when there is exactly one organization
      -- to mean, and refused rather than guessed when there is not.
      SELECT id INTO found FROM organizations
      WHERE (SELECT count(*) FROM organizations) = 1;
    ELSE
      found := NULL;
  END CASE;

  RETURN found;
EXCEPTION
  WHEN invalid_text_representation THEN
    -- A non-numeric id where one was expected is a bad request, not an error.
    RETURN NULL;
END
$$;--> statement-breakpoint

REVOKE ALL ON FUNCTION app_resolve_public_org(text, text) FROM PUBLIC;--> statement-breakpoint
GRANT EXECUTE ON FUNCTION app_resolve_public_org(text, text) TO openats_app;
