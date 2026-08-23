# Setting up WSO2 Identity Platform for OpenATS

OpenATS uses WSO2 Identity Platform for identity and access management. This guide walks you through creating an Identity Platform application so you can log in to your local OpenATS instance.

## 1. Create an Identity Platform account

Go to [console.asgardeo.io](https://console.asgardeo.io) and sign up for a free account.

## 2. Create a new application

In the console, go to **Applications**, then click **New Application**. Select **Next.js** from the list of application templates.

Fill in the fields:

- **Name**: any name you like, e.g. `OpenATS`
- **Authorized Redirect URL**: `http://localhost:3000`

Click **Create**.

## 3. Configure environment variables

After creating the application, open the **Guide** tab. It shows the environment variables you need.

Copy `frontend/.env.example` to `frontend/.env` if you haven't already, then fill in these values from the Guide tab:

- `NEXT_PUBLIC_ASGARDEO_BASE_URL` - shown as the Base URL
- `NEXT_PUBLIC_ASGARDEO_CLIENT_ID` - shown as the Client ID
- `ASGARDEO_CLIENT_SECRET` - shown as the Client Secret

> ⚠️ Never commit your Client Secret or paste it anywhere public. Treat it like a password.

Leave `NEXT_PUBLIC_ASGARDEO_SCOPES` as-is for now - the next step covers adding the extra scopes needed for user management.

## 4. Configure the Protocol tab

Open the **Protocol** tab of your application.

**Allowed grant types**: tick `Code`, `Client Credential`, and `Refresh Token`.

**Access Token**: set the token type to `JWT`, and add `email`, `roles`, and `application_roles` to the access token attributes (in addition to the defaults already selected). Also make sure `given_name` and `family_name` are included - the frontend profile settings page uses these to show the user's name.

**Refresh Token**: make sure `Renew refresh token` is enabled.

## 5. Configure the Login Flow

Open the **Login Flow** tab and use the **Visual Editor** to set up a simple username/password sign-in flow, as shown below:

![Login Flow](images/login-flow.png)

## 6. Authorize the User Management API resources

OpenATS manages users and roles through Asgardeo's SCIM2 and User Credential Management APIs, so the application needs access to them.

Open the **Authorization** tab and click **Authorize resource**. Authorize these APIs:

- SCIM2 Users API
- User Credential Management API v2
- SCIM2 Roles V1/V2 API
- User Credential Management API
- SCIM2 Roles V3 API

![Authorization tab](images/authorization-resources.png)

Once authorized, make sure the following scopes are requested (this is the extra part of `NEXT_PUBLIC_ASGARDEO_SCOPES` mentioned in step 3):

```
internal_role_mgt_create internal_role_mgt_delete internal_role_mgt_groups_update internal_role_mgt_meta_create internal_role_mgt_meta_update internal_role_mgt_update internal_role_mgt_users_update internal_role_mgt_view internal_user_credential_mgt_create internal_user_credential_mgt_delete internal_user_credential_mgt_view internal_user_mgt_create internal_user_mgt_delete internal_user_mgt_list internal_user_mgt_update internal_user_mgt_view
```

Add these to `NEXT_PUBLIC_ASGARDEO_SCOPES` in your `frontend/.env`, alongside `openid profile email offline_access`.

## 7. Create application roles

Open the **Roles** tab. With **Role Audience** set to `Application`, click **New Role** and create these roles, with the exact names:

- `Super Admin`
- `Hiring Manager`
- `Interviewer`

Multi-tenant installs need two more, for contacts at the client companies an
agency recruits for:

- `Client Admin`
- `Client Reviewer`

They cost nothing on a single-company install, where nothing will assign them.
`setup-asgardeo.sh` creates all five.

## 8. Enable App-Native Authentication

Open the **Advanced** tab and tick **Enable app-native authentication API** under **App-Native Authentication**. OpenATS uses in-app login forms instead of redirecting to the Asgardeo hosted login page, so this needs to be enabled.

## 9. Configure the backend `.env`

Open the **Info** tab of your application. Copy the JWKS URI and Issuer values into `backend/.env`:

- `ASGARDEO_JWKS_URL` - the JWKS URI shown in the Info tab
- `ASGARDEO_ISSUER` - the Issuer shown in the Info tab

## 10. Create a test user and assign a role

To develop and debug the app locally, you need at least one user assigned the `Super Admin` role.

1. Go to **User Management** > **Users** in the sidebar and create a user.
2. Go to **User Management** > **Roles**, open the `Super Admin` role (the application role you created in step 7).
3. Go to its **Users** tab and assign the user you just created.

That's it 🎉 Authentication should now work - go ahead and try out the application locally.

## 11. Multi-tenant only: provision an agency as a sub-organization

Skip this if you are running OpenATS for a single company. Everything above is
all a single-tenant install needs, and nothing here changes it.

OpenATS decides which tenant a person belongs to from the `org_id` claim on
their access token, which Asgardeo sets for tokens issued by a **B2B
sub-organization**. One sub-organization corresponds to one recruiting agency.

`setup-asgardeo.sh` can create one for you:

```bash
CREATE_SUB_ORG="Acme Recruiting" ./setup-asgardeo.sh
```

This needs the **Organization Management API** authorized on your M2M
application, in addition to the APIs listed in the prerequisites. The script
creates the sub-organization and shares the OpenATS application with it —
without that share, the tenant exists and nobody in it can sign in.

It then prints the SQL for the other half:

```sql
INSERT INTO organizations (name, slug, asgardeo_org_id)
VALUES ('Acme Recruiting', 'acme', '<the id the script printed>');
```

Both halves are required. A token naming a sub-organization that has no
`organizations` row is **refused**, deliberately: a sub-organization the
database has never heard of means someone provisioned a tenant in the identity
provider and not here, and creating one on the strength of a claim is how a
person ends up inside another tenant's data.

Users created inside the sub-organization get their roles there, not in the
root organization. The application roles from step 7 need to exist in each
sub-organization that uses them.

`setup-asgardeo.sh` creates the roles in whichever organization it is pointed
at, which is the root one. It does **not** create them inside a
sub-organization it has just made, so a new agency needs its roles adding
before anyone there can sign in. Once per agency, by hand, is fine; automating
it belongs with the rest of agency signup rather than here.
