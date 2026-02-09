# My Dashboard Plugin - Setup Guide

This guide walks you through setting up the My Dashboard plugin to embed Metabase dashboards.

## Prerequisites

- Metabase Pro or Enterprise (required for interactive embedding)
- Admin access to your Metabase instance
- NAAP shell application running

## Step 1: Enable Metabase Embedding

1. Log into your Metabase instance as an admin
2. Go to **Admin Settings** → **Embedding**
3. Toggle **Enable embedding in other applications** to ON
4. Toggle **Interactive embedding** to ON (requires Pro/Enterprise)
5. Copy the **Embedding secret key** - you'll need this later

## Step 2: Configure the Plugin

1. Log into the NAAP shell as an admin
2. Navigate to **My Dashboard** in the sidebar
3. Click **Settings** (gear icon)
4. Enter your Metabase configuration:
   - **Metabase URL**: Your Metabase instance URL (e.g., `https://your-org.metabaseapp.com`)
   - **Embedding Secret Key**: Paste the key from Step 1
   - **Token Expiry**: How long embed tokens are valid (default: 600 seconds)
   - **Interactive Mode**: Enable for full Metabase interactivity
5. Click **Save Changes**

## Step 3: Add Dashboards

1. In Metabase, note the dashboard IDs you want to embed
   - Open a dashboard → look at the URL: `/dashboard/123` → ID is 123
2. In the NAAP shell, go to **My Dashboard** → **Settings**
3. Under **Manage Dashboards**, enter:
   - **Dashboard ID**: The Metabase dashboard ID
   - **Display Name**: How it appears in the gallery
   - **Description**: Optional description
4. Click **Add**

## Step 4: Configure RBAC (Optional)

Assign roles to control access:

| Role | Permissions |
|------|-------------|
| `my-dashboard:admin` | Full access, configure settings, manage dashboards |
| `my-dashboard:user` | View dashboards, manage personal preferences |

To assign roles:
1. Go to **Admin** → **User Management**
2. Select a user
3. Assign the appropriate role

## Troubleshooting

### "Metabase is not configured"
- Ensure you've entered both the Metabase URL and secret key
- Check that the URL doesn't have a trailing slash

### "Failed to load dashboard"
- Verify the dashboard ID is correct
- Ensure the dashboard is published (not in draft mode)
- Check that interactive embedding is enabled in Metabase

### Embed shows "Not Found"
- The dashboard may have been deleted or the ID changed
- Re-verify the dashboard ID in Metabase

### Token errors
- Increase the token expiry time
- Ensure your server clock is synchronized

## Security Notes

- The embedding secret key is stored encrypted in the database
- Embed tokens are signed with the secret and include expiration
- User context is passed to Metabase for row-level security
- All API requests are rate-limited

## Support

For issues or feature requests, contact the NAAP team.
