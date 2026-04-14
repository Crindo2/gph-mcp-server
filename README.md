# GPH Intelligence — Healthcare Service Provider Finder

An MCP server that gives AI agents access to 103,000+ verified healthcare service providers across the United States. Built for practice managers, healthcare AI developers, and anyone building tools for the medical practice market.

## What It Does

The GPH Intelligence MCP server provides structured access to GetPracticeHelp's database of healthcare service vendors — medical billing companies, credentialing services, EHR consultants, healthcare attorneys, compliance firms, and more — across 25 categories and all 50 states.

## Tools

### `match_practice`
Find the best healthcare service providers for a medical practice based on specialty, size, location, EHR system, and budget. Returns ranked matches with quality scores.

**Parameters:**
- `category` (required) — Service category (e.g. "Medical Billing & RCM", "Credentialing Services")
- `state` (required) — Two-letter state abbreviation (e.g. "TX", "CA")
- `specialty` — Practice specialty (e.g. "Family Medicine", "Cardiology")
- `practice_size` — "Solo", "Small", "Mid-size", or "Large"
- `city` — City name
- `ehr_system` — EHR system in use (e.g. "Epic", "athenahealth")
- `budget_range` — Monthly budget range

### `search_providers`
Search for healthcare service providers by category, location, and quality rating. Returns paginated results.

**Parameters:**
- `category` (required) — Service category to search
- `state` — Two-letter state abbreviation
- `city` — City name filter
- `min_rating` — Minimum quality score (0-100)
- `per_page` — Results per page (default 10, max 50)
- `page` — Page number

### `get_provider_detail`
Get full profile for a specific provider including description, services, contact information, and quality score.

**Parameters:**
- `slug` (required) — Provider slug identifier (e.g. "ams-solutions-inc-dallas-tx")

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
      "args": ["-y", "@smithery/cli@latest", "run", "cbeggroup/getpracticehelp", "--key", "YOUR_SMITHERY_KEY"]
    }
  }
}
```

### Connect via Smithery
```bash
smithery mcp add cbeggroup/getpracticehelp
```

## Data Coverage

- **103,000+** verified healthcare service providers
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

Free tier: 25 calls/month — no API key required.

Paid tiers available at [getpracticehelp.com/api-access/](https://www.getpracticehelp.com/api-access/)

## Links

- **Homepage:** [getpracticehelp.com](https://www.getpracticehelp.com)
- **Provider Directory:** [getpracticehelp.com/providers/](https://www.getpracticehelp.com/providers/)
- **Smithery:** [smithery.ai/server/cbeggroup/getpracticehelp](https://smithery.ai/server/cbeggroup/getpracticehelp)

## License

MIT
