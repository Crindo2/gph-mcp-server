# GPH Intelligence - Healthcare Vendor Finder

An MCP server that gives AI agents access to 76,000+ curated healthcare service vendors across the United States. Built for practice managers, healthcare AI developers, and anyone building tools for the medical practice market.

## What It Does

The GPH Intelligence MCP server provides structured access to GetPracticeHelp's database of healthcare service vendors -- medical billing companies, credentialing services, EHR consultants, healthcare attorneys, compliance firms, and more -- across 25 categories and all 50 states.

## Tools

### `match_practice`
Find the best healthcare service vendors for a medical practice based on specialty, size, location, EHR system, and budget. Returns ranked matches with quality scores.

**Parameters:**
- `category` (required) -- Service category (e.g. "Medical Billing & RCM", "Credentialing Services")
- `state` (required) -- Two-letter state abbreviation (e.g. "TX", "CA")
- `specialty` -- Practice specialty (e.g. "Family Medicine", "Cardiology")
- `practice_size` -- "Solo", "Small", "Mid-size", or "Large"
- `city` -- City name
- `ehr_system` -- EHR system in use (e.g. "Epic", "athenahealth")
- `budget_range` -- Monthly budget range

### `search_providers`
Search the vendor directory by category, location, and quality rating. Returns paginated results.

**Parameters:**
- `category` (required) -- Service category to search
- `state` -- Two-letter state abbreviation
- `city` -- City name filter
- `min_rating` -- Minimum quality score (0-100)
- `per_page` -- Results per page (default 10, max 25)
- `page` -- Page number

### `get_provider_detail`
Get the full profile for a specific vendor including description, services, contact information, and quality score.

**Parameters:**
- `slug` (required) -- Vendor slug identifier (e.g. "ams-solutions-inc-dallas-tx")

## Usage

### MCP Endpoint
```
https://gph-mcp-server.pages.dev/mcp
```

### Connect via Claude Desktop
Add to your `claude_desktop_config.json`:
```json
{
  "mcpServers": {
    "gph-intelligence": {
      "command": "npx",
      "args": ["-y", "mcp-remote", "https://gph-mcp-server.pages.dev/mcp"]
    }
  }
}
```
No API key required.

## Data Coverage

- **76,000+** curated healthcare service vendors
- **25** service categories across 6 super-categories
- **All 50 states** + DC
- **Quality scores** based on Google ratings, review volume, and verification status
- Monthly data refreshes

## Categories

**Operations & Administration**
Medical Billing & RCM, Credentialing Services, Medical Coding, Practice Management Consulting, Healthcare Staffing & Recruiting

**Technology**
Healthcare IT & EHR, Telehealth & Virtual Care, Medical Transcription & Documentation

**Legal, Finance & Compliance**
Healthcare Legal Services, Healthcare CPA & Tax Advisory, Compliance & HIPAA, Practice Financing, Practice Valuation & Brokerage, Malpractice Insurance

**Facilities & Equipment**
Healthcare Construction & Facilities, Medical Equipment & Supplies, Healthcare Real Estate, Signage & Wayfinding, Medical Waste & Environmental

**Growth & Marketing**
Healthcare Marketing, Patient Financing, Group Purchasing Organizations, PR & Communications

**Clinical Support**
Pharmacy & Medication Management, Laboratory & Diagnostics

## API Access

Free: 100 calls per IP per day, no API key required.

For bulk or unmetered access, license the dataset at [getpracticehelp.com/data-licensing/](https://www.getpracticehelp.com/data-licensing/)

## Troubleshooting

- **No results returned** -- broaden your query. `category` is required, so make sure it is set; then try removing the `city`/`min_rating` filters or widening the `state` (national providers are always included).
- **HTTP 429 (rate limited)** -- the free tier allows 100 calls per IP per day, resetting at 00:00 UTC. For higher volume, license the dataset (see API Access above).
- **Can't connect** -- point your client at the remote endpoint, no API key required:
  ```
  npx -y mcp-remote https://gph-mcp-server.pages.dev/mcp
  ```
- **403 from a browser** -- the `/mcp` endpoint validates the `Origin` header to prevent DNS rebinding. Standard MCP clients (Claude Desktop, `mcp-remote`, server-to-server) send no `Origin` header and connect fine; only disallowed browser origins are blocked.
- **Support** -- questions or higher-volume access requests: cbeggroup@gmail.com

## Links

- **Homepage:** [getpracticehelp.com](https://www.getpracticehelp.com)
- **Provider Directory:** [getpracticehelp.com/providers/](https://www.getpracticehelp.com/providers/)
- **Smithery:** [smithery.ai/server/cbeggroup/getpracticehelp](https://smithery.ai/server/cbeggroup/getpracticehelp)
- **Privacy:** [gph-mcp-server.pages.dev/privacy](https://gph-mcp-server.pages.dev/privacy)

## License

MIT
