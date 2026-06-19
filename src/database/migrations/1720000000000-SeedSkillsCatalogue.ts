import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Adds a stable `slug` to skills and seeds the marketing catalogue (Google Ads,
 * Meta Ads and Analytics skills) so the dashboard has real data to install.
 * Idempotent on slug: re-running skips rows that already exist.
 */
export class SeedSkillsCatalogue1720000000000 implements MigrationInterface {
  name = 'SeedSkillsCatalogue1720000000000';

  private readonly skills: Array<{
    slug: string;
    name: string;
    description: string;
    category: string;
    systemPrompt: string;
    author: string;
    tags: string[];
  }> = [
    {
        "slug": "google_ads_analyze_landing_pages",
        "name": "Analyze Landing Pages",
        "description": "Improve Quality Scores and ad relevance by identifying content gaps between your keywords and landing pages.",
        "category": "Google Ads",
        "systemPrompt": "You are operating the \"Analyze Landing Pages\" skill. Improve Quality Scores and ad relevance by identifying content gaps between your keywords and landing pages.",
        "author": "Julio Casado",
        "tags": [
            "google-ads",
            "quality-score-optimization",
            "keyword-alignment",
            "search-term-analysis"
        ]
    },
    {
        "slug": "meta_ads_generate_creative_brief",
        "name": "Generate Creative Brief",
        "description": "Bridge the gap between performance data and creative production with prioritized concepts and hook strategies.",
        "category": "Meta Ads",
        "systemPrompt": "You are operating the \"Generate Creative Brief\" skill. Bridge the gap between performance data and creative production with prioritized concepts and hook strategies.",
        "author": "Matt Swulinski",
        "tags": [
            "meta-ads",
            "creative",
            "performance-marketing"
        ]
    },
    {
        "slug": "meta_ads_analyze_creative",
        "name": "Analyze Creative",
        "description": "Optimize Meta Ads performance by identifying winning creatives and detecting ad fatigue before CPA rises.",
        "category": "Meta Ads",
        "systemPrompt": "You are operating the \"Analyze Creative\" skill. Optimize Meta Ads performance by identifying winning creatives and detecting ad fatigue before CPA rises.",
        "author": "Matt Swulinski",
        "tags": [
            "meta-ads",
            "audit-creative",
            "analyze",
            "ads-review"
        ]
    },
    {
        "slug": "meta_ads_analyze_advantage_plus",
        "name": "Analyze Advantage+",
        "description": "Optimize Meta Advantage+ campaigns by identifying performance gaps between automated and manual strategies.",
        "category": "Meta Ads",
        "systemPrompt": "You are operating the \"Analyze Advantage+\" skill. Optimize Meta Advantage+ campaigns by identifying performance gaps between automated and manual strategies.",
        "author": "Matt Swulinski",
        "tags": [
            "meta-ads",
            "advantage-plus",
            "audience-segmentation",
            "analyze"
        ]
    },
    {
        "slug": "google_ads_analyze_youtube",
        "name": "Analyze YouTube",
        "description": "Optimize video ad performance and funnel strategy with data-driven insights from Google Ads.",
        "category": "Google Ads",
        "systemPrompt": "You are operating the \"Analyze YouTube\" skill. Optimize video ad performance and funnel strategy with data-driven insights from Google Ads.",
        "author": "Julio Casado",
        "tags": [
            "google-ads",
            "video-performance",
            "asset-evaluation"
        ]
    },
    {
        "slug": "meta_ads_audit_audiences",
        "name": "Audit Audiences",
        "description": "Optimize Meta Ads performance by identifying audience overlap and saturation before they impact CPA.",
        "category": "Meta Ads",
        "systemPrompt": "You are operating the \"Audit Audiences\" skill. Optimize Meta Ads performance by identifying audience overlap and saturation before they impact CPA.",
        "author": "Matt Swulinski",
        "tags": [
            "meta-ads",
            "audience-overlap",
            "ad-fatigue",
            "audit-reporting"
        ]
    },
    {
        "slug": "meta_ads_account_conventions",
        "name": "Account Conventions",
        "description": "Configuration engine for the Meta Ads Analysis Toolkit. Defines account identities, pixel/CAPI setup, KPI targets, flag thresholds, naming conventions, and business models. Every other skill in the toolkit reads from...",
        "category": "Meta Ads",
        "systemPrompt": "You are operating the \"Account Conventions\" skill. Configuration engine for the Meta Ads Analysis Toolkit. Defines account identities, pixel/CAPI setup, KPI targets, flag thresholds, naming conventions, and business models. Every other skill in the toolkit reads from...",
        "author": "Matt Swulinski",
        "tags": [
            "meta-ads",
            "account-conventions",
            "account-setup",
            "conversion-lag"
        ]
    },
    {
        "slug": "meta_ads_performance_analysis",
        "name": "Meta Ads Performance Analysis",
        "description": "Instantly surface Meta Ads performance trends and critical issues without manual data pulling or spreadsheet calculations.",
        "category": "Meta Ads",
        "systemPrompt": "You are operating the \"Meta Ads Performance Analysis\" skill. Instantly surface Meta Ads performance trends and critical issues without manual data pulling or spreadsheet calculations.",
        "author": "Matt Swulinski",
        "tags": [
            "meta-ads",
            "analyze",
            "campaign-automation",
            "investigate-campaign"
        ]
    },
    {
        "slug": "meta_ads_advantage_plus_methodology",
        "name": "Advantage+ Methodology",
        "description": "Implement Meta's latest AI-driven advertising strategies and prepare for the 2026 Advantage+ migration.",
        "category": "Meta Ads",
        "systemPrompt": "You are operating the \"Advantage+ Methodology\" skill. Implement Meta's latest AI-driven advertising strategies and prepare for the 2026 Advantage+ migration.",
        "author": "Matt Swulinski",
        "tags": [
            "meta-ads",
            "advantage-plus",
            "campaign-automation",
            "target-optimization"
        ]
    },
    {
        "slug": "meta_ads_weekly_review",
        "name": "Meta Ads Weekly Review",
        "description": "Automate complex Meta Ads account diagnostics and reporting while maintaining human control over every recommendation.",
        "category": "Meta Ads",
        "systemPrompt": "You are operating the \"Meta Ads Weekly Review\" skill. Automate complex Meta Ads account diagnostics and reporting while maintaining human control over every recommendation.",
        "author": "Matt Swulinski",
        "tags": [
            "meta-ads",
            "ads-review",
            "review"
        ]
    },
    {
        "slug": "meta_ads_launch_campaign",
        "name": "Meta Ads Launch Campaign",
        "description": "Automate the complex setup of Meta Ads campaigns while ensuring compliance with naming conventions and measurement best practices.",
        "category": "Meta Ads",
        "systemPrompt": "You are operating the \"Meta Ads Launch Campaign\" skill. Automate the complex setup of Meta Ads campaigns while ensuring compliance with naming conventions and measurement best practices.",
        "author": "Matt Swulinski",
        "tags": [
            "meta-ads",
            "campaign-automation",
            "account-conventions",
            "ads-review"
        ]
    },
    {
        "slug": "meta_ads_audit_bidding",
        "name": "Meta Ads Bidding Audit",
        "description": "Optimize Meta Ads performance by aligning bidding strategies with account maturity and KPI targets while avoiding learning phase disruptions.",
        "category": "Meta Ads",
        "systemPrompt": "You are operating the \"Meta Ads Bidding Audit\" skill. Optimize Meta Ads performance by aligning bidding strategies with account maturity and KPI targets while avoiding learning phase disruptions.",
        "author": "Matt Swulinski",
        "tags": [
            "meta-ads",
            "bidding-strategy",
            "ads-review"
        ]
    },
    {
        "slug": "meta_ads_campaign_structure_methodology",
        "name": "Meta Ads Campaign Structure Methodology",
        "description": "Optimize Meta Ads performance by implementing a proven campaign structure that balances algorithmic scaling with systematic creative testing.",
        "category": "Meta Ads",
        "systemPrompt": "You are operating the \"Meta Ads Campaign Structure Methodology\" skill. Optimize Meta Ads performance by implementing a proven campaign structure that balances algorithmic scaling with systematic creative testing.",
        "author": "Matt Swulinski",
        "tags": [
            "meta-ads",
            "account-conventions",
            "campaign-scaling",
            "advantage-plus"
        ]
    },
    {
        "slug": "meta_ads_creative_strategy_methodology",
        "name": "Meta Ads Creative Strategy Methodology",
        "description": "Systematize your Meta Ads creative process with battle-tested testing methodologies and performance benchmarks.",
        "category": "Meta Ads",
        "systemPrompt": "You are operating the \"Meta Ads Creative Strategy Methodology\" skill. Systematize your Meta Ads creative process with battle-tested testing methodologies and performance benchmarks.",
        "author": "Matt Swulinski",
        "tags": [
            "meta-ads",
            "creative",
            "ad-fatigue",
            "audit-creative"
        ]
    },
    {
        "slug": "meta_ads_audience_methodology",
        "name": "Meta Ads Audience Methodology",
        "description": "Optimize Meta Ads performance by applying the right targeting strategy based on account data maturity and algorithmic efficiency.",
        "category": "Meta Ads",
        "systemPrompt": "You are operating the \"Meta Ads Audience Methodology\" skill. Optimize Meta Ads performance by applying the right targeting strategy based on account data maturity and algorithmic efficiency.",
        "author": "Matt Swulinski",
        "tags": [
            "meta-ads",
            "audience-segmentation",
            "advantage-plus",
            "maturity-assessment"
        ]
    },
    {
        "slug": "meta_ads_analyze_catalog",
        "name": "Analyze Meta Ads Catalog",
        "description": "Maximize ROAS by identifying high-potential products and fixing feed quality issues in Meta Ads catalogs.",
        "category": "Meta Ads",
        "systemPrompt": "You are operating the \"Analyze Meta Ads Catalog\" skill. Maximize ROAS by identifying high-potential products and fixing feed quality issues in Meta Ads catalogs.",
        "author": "Matt Swulinski",
        "tags": [
            "meta-ads",
            "feed-audit",
            "performance-tiering",
            "product-performance"
        ]
    },
    {
        "slug": "meta_ads_audit_structure",
        "name": "Audit Structure",
        "description": "Optimize Meta Ads performance by consolidating fragmented structures and aligning with the three-campaign model.",
        "category": "Meta Ads",
        "systemPrompt": "You are operating the \"Audit Structure\" skill. Optimize Meta Ads performance by consolidating fragmented structures and aligning with the three-campaign model.",
        "author": "Matt Swulinski",
        "tags": [
            "meta-ads",
            "account-conventions",
            "ads-review",
            "account-setup"
        ]
    },
    {
        "slug": "meta_ads_investigate_campaign",
        "name": "Meta Ads Investigate Campaign",
        "description": "Identify the true cause of poor Meta Ads performance and get a prioritized action plan instead of guessing at fixes.",
        "category": "Meta Ads",
        "systemPrompt": "You are operating the \"Meta Ads Investigate Campaign\" skill. Identify the true cause of poor Meta Ads performance and get a prioritized action plan instead of guessing at fixes.",
        "author": "Matt Swulinski",
        "tags": [
            "meta-ads",
            "investigate-campaign",
            "audience-segmentation",
            "audit-creative"
        ]
    },
    {
        "slug": "meta_ads_bidding_methodology",
        "name": "Meta Ads Bidding Methodology",
        "description": "Scale Meta Ads efficiently by applying the correct bidding strategy for your specific account maturity and business model.",
        "category": "Meta Ads",
        "systemPrompt": "You are operating the \"Meta Ads Bidding Methodology\" skill. Scale Meta Ads efficiently by applying the correct bidding strategy for your specific account maturity and business model.",
        "author": "Matt Swulinski",
        "tags": [
            "meta-ads",
            "bidding-strategy",
            "maturity-assessment",
            "cost-cap"
        ]
    },
    {
        "slug": "meta_ads_optimize_budgets",
        "name": "Meta Ads Budget Optimization",
        "description": "Maximize campaign ROI by shifting budget from diminishing-return campaigns to constrained-efficient ones based on data-driven modeling.",
        "category": "Meta Ads",
        "systemPrompt": "You are operating the \"Meta Ads Budget Optimization\" skill. Maximize campaign ROI by shifting budget from diminishing-return campaigns to constrained-efficient ones based on data-driven modeling.",
        "author": "Matt Swulinski",
        "tags": [
            "meta-ads",
            "budget-optimization",
            "budget-pacing",
            "campaign-scaling"
        ]
    },
    {
        "slug": "meta_ads_account_maturity_methodology",
        "name": "Account Maturity Methodology",
        "description": "Ensure every Meta Ads recommendation is perfectly sized for your account's data volume and budget.",
        "category": "Meta Ads",
        "systemPrompt": "You are operating the \"Account Maturity Methodology\" skill. Ensure every Meta Ads recommendation is perfectly sized for your account's data volume and budget.",
        "author": "Matt Swulinski",
        "tags": [
            "meta-ads",
            "maturity-assessment",
            "account-sophistication"
        ]
    },
    {
        "slug": "meta_ads_campaign_diagnostics_methodology",
        "name": "Meta Ads Campaign Diagnostics Methodology",
        "description": "Identify the exact cause of poor Meta Ads performance and implement the correct fix in under 30 minutes.",
        "category": "Meta Ads",
        "systemPrompt": "You are operating the \"Meta Ads Campaign Diagnostics Methodology\" skill. Identify the exact cause of poor Meta Ads performance and implement the correct fix in under 30 minutes.",
        "author": "Matt Swulinski",
        "tags": [
            "meta-ads",
            "investigate-campaign",
            "attribution-diagnostics",
            "audit-creative"
        ]
    },
    {
        "slug": "meta_ads_audit_measurement",
        "name": "Meta Ads Audit Measurement",
        "description": "Ensure data-driven scaling by identifying and fixing gaps in your Meta Ads tracking and attribution stack.",
        "category": "Meta Ads",
        "systemPrompt": "You are operating the \"Meta Ads Audit Measurement\" skill. Ensure data-driven scaling by identifying and fixing gaps in your Meta Ads tracking and attribution stack.",
        "author": "Matt Swulinski",
        "tags": [
            "meta-ads",
            "data-connections",
            "attribution-diagnostics",
            "audit-reporting"
        ]
    },
    {
        "slug": "meta_ads_audit_compliance",
        "name": "Meta Ads Audit Compliance",
        "description": "Proactively identify and fix Meta Ads compliance issues to prevent account shutdowns and ad disapprovals.",
        "category": "Meta Ads",
        "systemPrompt": "You are operating the \"Meta Ads Audit Compliance\" skill. Proactively identify and fix Meta Ads compliance issues to prevent account shutdowns and ad disapprovals.",
        "author": "Matt Swulinski",
        "tags": [
            "meta-ads",
            "privacy-compliance",
            "data-connections",
            "ads-review"
        ]
    },
    {
        "slug": "meta_ads_manage_automated_rules",
        "name": "Meta Ads Automated Rules",
        "description": "Protect your Meta Ads spend and automate scaling with human-approved guardian rules.",
        "category": "Meta Ads",
        "systemPrompt": "You are operating the \"Meta Ads Automated Rules\" skill. Protect your Meta Ads spend and automate scaling with human-approved guardian rules.",
        "author": "Matt Swulinski",
        "tags": [
            "meta-ads",
            "campaign-automation",
            "ad-fatigue",
            "ads-review"
        ]
    },
    {
        "slug": "meta_ads_compliance_methodology",
        "name": "Meta Ads Compliance Methodology",
        "description": "Protect your advertising accounts from bans and legal penalties by following a structured compliance methodology for Meta Ads.",
        "category": "Meta Ads",
        "systemPrompt": "You are operating the \"Meta Ads Compliance Methodology\" skill. Protect your advertising accounts from bans and legal penalties by following a structured compliance methodology for Meta Ads.",
        "author": "Matt Swulinski",
        "tags": [
            "meta-ads",
            "privacy-compliance",
            "ads-review",
            "special-ad-categories"
        ]
    },
    {
        "slug": "meta_ads_measurement_methodology",
        "name": "Meta Ads Measurement Methodology",
        "description": "Implement a robust measurement stack for Meta Ads to accurately attribute conversions and optimize budget allocation using CAPI, incrementality testing, and third-party tools.",
        "category": "Meta Ads",
        "systemPrompt": "You are operating the \"Meta Ads Measurement Methodology\" skill. Implement a robust measurement stack for Meta Ads to accurately attribute conversions and optimize budget allocation using CAPI, incrementality testing, and third-party tools.",
        "author": "Matt Swulinski",
        "tags": [
            "meta-ads",
            "attribution-windows",
            "conversions-api",
            "third-party-attribution"
        ]
    },
    {
        "slug": "meta_ads_placement_methodology",
        "name": "Meta Ads Placement Methodology",
        "description": "Optimize ad delivery and creative performance by leveraging data-driven placement benchmarks and platform-specific specifications.",
        "category": "Meta Ads",
        "systemPrompt": "You are operating the \"Meta Ads Placement Methodology\" skill. Optimize ad delivery and creative performance by leveraging data-driven placement benchmarks and platform-specific specifications.",
        "author": "Matt Swulinski",
        "tags": [
            "meta-ads",
            "advantage-plus",
            "creative"
        ]
    },
    {
        "slug": "meta_ads_budget_methodology",
        "name": "Meta Ads Budget Methodology",
        "description": "Optimize Meta Ads performance with a proven three-tier allocation model and systematic scaling protocols.",
        "category": "Meta Ads",
        "systemPrompt": "You are operating the \"Meta Ads Budget Methodology\" skill. Optimize Meta Ads performance with a proven three-tier allocation model and systematic scaling protocols.",
        "author": "Matt Swulinski",
        "tags": [
            "meta-ads",
            "budget-optimization",
            "campaign-scaling",
            "budget-pacing"
        ]
    },
    {
        "slug": "meta_ads_catalog_methodology",
        "name": "Meta Ads Catalog Methodology",
        "description": "Improve ROAS and ad quality by implementing a structured product tiering and feed optimization system for Meta Ads.",
        "category": "Meta Ads",
        "systemPrompt": "You are operating the \"Meta Ads Catalog Methodology\" skill. Improve ROAS and ad quality by implementing a structured product tiering and feed optimization system for Meta Ads.",
        "author": "Matt Swulinski",
        "tags": [
            "meta-ads",
            "feed-audit",
            "performance-tiering",
            "audience-segmentation"
        ]
    },
    {
        "slug": "google_ads_search_term_methodology",
        "name": "Search Term Methodology",
        "description": "Standardize search term management to eliminate wasted spend and scale high-performing keywords with a proven methodology.",
        "category": "Google Ads",
        "systemPrompt": "You are operating the \"Search Term Methodology\" skill. Standardize search term management to eliminate wasted spend and scale high-performing keywords with a proven methodology.",
        "author": "Julio Casado",
        "tags": [
            "google-ads",
            "negative-keywords",
            "search-term-analysis",
            "keyword-alignment"
        ]
    },
    {
        "slug": "google_ads_mine_search_terms",
        "name": "Mine Search Terms",
        "description": "Automate the tedious process of mining search terms and generating Google Ads Editor-ready negative keyword lists.",
        "category": "Google Ads",
        "systemPrompt": "You are operating the \"Mine Search Terms\" skill. Automate the tedious process of mining search terms and generating Google Ads Editor-ready negative keyword lists.",
        "author": "Julio Casado",
        "tags": [
            "google-ads",
            "search-term-analysis",
            "negative-keywords",
            "keyword-expansion"
        ]
    },
    {
        "slug": "google_ads_audit_creative",
        "name": "Audit Creative",
        "description": "Improve campaign ROI by systematically auditing ad assets and generating data-driven creative refresh plans.",
        "category": "Google Ads",
        "systemPrompt": "You are operating the \"Audit Creative\" skill. Improve campaign ROI by systematically auditing ad assets and generating data-driven creative refresh plans.",
        "author": "Julio Casado",
        "tags": [
            "google-ads",
            "audit-creative",
            "pmax-audit",
            "asset-evaluation"
        ]
    },
    {
        "slug": "google_ads_youtube_methodology",
        "name": "YouTube Methodology",
        "description": "Standardize YouTube campaign analysis and strategy with a comprehensive full-funnel methodology.",
        "category": "Google Ads",
        "systemPrompt": "You are operating the \"YouTube Methodology\" skill. Standardize YouTube campaign analysis and strategy with a comprehensive full-funnel methodology.",
        "author": "Julio Casado",
        "tags": [
            "google-ads",
            "full-funnel-marketing",
            "audience-segmentation"
        ]
    },
    {
        "slug": "google_ads_investigate_campaign",
        "name": "Investigate Campaign",
        "description": "Action skill that performs systematic root cause diagnosis for underperforming Google Ads campaigns. Walks through the diagnostic tree (measurement, auction, targeting, creative, landing page, budget, bidding, externa...",
        "category": "Google Ads",
        "systemPrompt": "You are operating the \"Investigate Campaign\" skill. Action skill that performs systematic root cause diagnosis for underperforming Google Ads campaigns. Walks through the diagnostic tree (measurement, auction, targeting, creative, landing page, budget, bidding, externa...",
        "author": "Julio Casado",
        "tags": [
            "google-ads",
            "investigate-campaign",
            "investigate",
            "campaign-settings"
        ]
    },
    {
        "slug": "google_ads_performance_analysis",
        "name": "Performance Analysis",
        "description": "Automate weekly or monthly Google Ads performance reporting with standardized dashboards and trend flagging.",
        "category": "Google Ads",
        "systemPrompt": "You are operating the \"Performance Analysis\" skill. Automate weekly or monthly Google Ads performance reporting with standardized dashboards and trend flagging.",
        "author": "Julio Casado",
        "tags": [
            "google-ads",
            "gaql-queries",
            "analyze",
            "investigate-campaign"
        ]
    },
    {
        "slug": "google_ads_audit_local",
        "name": "Audit Local",
        "description": "Optimize local ad spend and drive more store visits by identifying gaps in GBP integration and location targeting.",
        "category": "Google Ads",
        "systemPrompt": "You are operating the \"Audit Local\" skill. Optimize local ad spend and drive more store visits by identifying gaps in GBP integration and location targeting.",
        "author": "Julio Casado",
        "tags": [
            "google-ads",
            "gbp-integration",
            "location-targeting",
            "lsa-performance"
        ]
    },
    {
        "slug": "google_ads_account_conventions",
        "name": "Account Conventions",
        "description": "Centralize and standardize Google Ads account metadata to power automated analysis and reporting across your entire toolkit.",
        "category": "Google Ads",
        "systemPrompt": "You are operating the \"Account Conventions\" skill. Centralize and standardize Google Ads account metadata to power automated analysis and reporting across your entire toolkit.",
        "author": "Julio Casado",
        "tags": [
            "google-ads",
            "account-setup",
            "maturity-assessment",
            "conversion-mapping"
        ]
    },
    {
        "slug": "google_ads_review",
        "name": "Google Ads Review",
        "description": "Streamline recurring Google Ads audits by automatically routing accounts to specialized analysis skills based on their specific configuration.",
        "category": "Google Ads",
        "systemPrompt": "You are operating the \"Google Ads Review\" skill. Streamline recurring Google Ads audits by automatically routing accounts to specialized analysis skills based on their specific configuration.",
        "author": "Julio Casado",
        "tags": [
            "google-ads",
            "ads-review",
            "call-google",
            "review"
        ]
    },
    {
        "slug": "google_ads_local_methodology",
        "name": "Google Ads Local Methodology",
        "description": "Standardize local advertising audits with a proven framework for location targeting, conversion tracking, and campaign selection.",
        "category": "Google Ads",
        "systemPrompt": "You are operating the \"Google Ads Local Methodology\" skill. Standardize local advertising audits with a proven framework for location targeting, conversion tracking, and campaign selection.",
        "author": "Julio Casado",
        "tags": [
            "google-ads",
            "location-targeting",
            "gbp-integration",
            "lsa-performance"
        ]
    },
    {
        "slug": "google_ads_optimize_budgets",
        "name": "Optimize Budgets",
        "description": "Maximize Google Ads ROI by reallocating budget from diminishing-return campaigns to high-efficiency, budget-constrained ones.",
        "category": "Google Ads",
        "systemPrompt": "You are operating the \"Optimize Budgets\" skill. Maximize Google Ads ROI by reallocating budget from diminishing-return campaigns to high-efficiency, budget-constrained ones.",
        "author": "Julio Casado",
        "tags": [
            "google-ads",
            "budget-optimization",
            "reallocation-modeling",
            "gaql-queries"
        ]
    },
    {
        "slug": "google_ads_analyze_demand_gen",
        "name": "Analyze Demand Gen",
        "description": "Action skill that analyzes Demand Gen campaigns in Google Ads. Evaluates performance by placement, audience, and creative format. For lead gen accounts, assesses lead quality. Analyzes cross-channel impact and increme...",
        "category": "Google Ads",
        "systemPrompt": "You are operating the \"Analyze Demand Gen\" skill. Action skill that analyzes Demand Gen campaigns in Google Ads. Evaluates performance by placement, audience, and creative format. For lead gen accounts, assesses lead quality. Analyzes cross-channel impact and increme...",
        "author": "Julio Casado",
        "tags": [
            "google-ads",
            "analyze-demand",
            "demand-gen",
            "analyze"
        ]
    },
    {
        "slug": "google_ads_audit_settings",
        "name": "Google Ads Audit Settings",
        "description": "Ensure Google Ads accounts follow best practices for tracking, compliance, and campaign configuration with automated settings audits.",
        "category": "Google Ads",
        "systemPrompt": "You are operating the \"Google Ads Audit Settings\" skill. Ensure Google Ads accounts follow best practices for tracking, compliance, and campaign configuration with automated settings audits.",
        "author": "Julio Casado",
        "tags": [
            "google-ads",
            "conversion-tracking",
            "privacy-compliance",
            "campaign-settings"
        ]
    },
    {
        "slug": "google_ads_analyze_pmax",
        "name": "Analyze PMax",
        "description": "Decompose PMax spend across 8 channels and audit asset performance to optimize campaign efficiency.",
        "category": "Google Ads",
        "systemPrompt": "You are operating the \"Analyze PMax\" skill. Decompose PMax spend across 8 channels and audit asset performance to optimize campaign efficiency.",
        "author": "Julio Casado",
        "tags": [
            "google-ads",
            "pmax-audit",
            "channel-breakdown",
            "asset-evaluation"
        ]
    },
    {
        "slug": "google_ads_creative_methodology",
        "name": "Google Ads Creative Methodology",
        "description": "Standardize your ad creative audits with a data-driven methodology for RSA, PMax, and video assets.",
        "category": "Google Ads",
        "systemPrompt": "You are operating the \"Google Ads Creative Methodology\" skill. Standardize your ad creative audits with a data-driven methodology for RSA, PMax, and video assets.",
        "author": "Julio Casado",
        "tags": [
            "google-ads",
            "audit-creative",
            "asset-evaluation",
            "rsa-optimization"
        ]
    },
    {
        "slug": "google_ads_audit_bidding",
        "name": "Google Ads Bidding Audit",
        "description": "Ensure your Google Ads campaigns use the most effective bidding strategies and realistic targets to maximize ROI.",
        "category": "Google Ads",
        "systemPrompt": "You are operating the \"Google Ads Bidding Audit\" skill. Ensure your Google Ads campaigns use the most effective bidding strategies and realistic targets to maximize ROI.",
        "author": "Julio Casado",
        "tags": [
            "google-ads",
            "smart-bidding",
            "bidding-migration",
            "portfolio-bidding"
        ]
    },
    {
        "slug": "google_ads_settings_methodology",
        "name": "Google Ads Settings Methodology",
        "description": "Ensure Google Ads accounts are configured correctly to prevent budget waste and data corruption.",
        "category": "Google Ads",
        "systemPrompt": "You are operating the \"Google Ads Settings Methodology\" skill. Ensure Google Ads accounts are configured correctly to prevent budget waste and data corruption.",
        "author": "Julio Casado",
        "tags": [
            "google-ads",
            "ads-review",
            "conversion-tracking",
            "data-connections"
        ]
    },
    {
        "slug": "google_ads_account_maturity_methodology",
        "name": "Account Maturity Methodology",
        "description": "Ensure Google Ads recommendations are perfectly tailored to an account's actual data volume and technical sophistication.",
        "category": "Google Ads",
        "systemPrompt": "You are operating the \"Account Maturity Methodology\" skill. Ensure Google Ads recommendations are perfectly tailored to an account's actual data volume and technical sophistication.",
        "author": "Julio Casado",
        "tags": [
            "google-ads",
            "maturity-assessment",
            "account-sophistication"
        ]
    },
    {
        "slug": "google_ads_bidding_methodology",
        "name": "Google Ads Bidding Methodology",
        "description": "Standardize bidding strategy selection with a framework calibrated for account maturity and data reliability.",
        "category": "Google Ads",
        "systemPrompt": "You are operating the \"Google Ads Bidding Methodology\" skill. Standardize bidding strategy selection with a framework calibrated for account maturity and data reliability.",
        "author": "Julio Casado",
        "tags": [
            "google-ads",
            "smart-bidding",
            "bidding-strategy",
            "portfolio-bidding"
        ]
    },
    {
        "slug": "google_ads_campaign_diagnostics_methodology",
        "name": "Google Ads Campaign Diagnostics Methodology",
        "description": "Systematically identify why Google Ads campaigns are underperforming before making costly optimization mistakes.",
        "category": "Google Ads",
        "systemPrompt": "You are operating the \"Google Ads Campaign Diagnostics Methodology\" skill. Systematically identify why Google Ads campaigns are underperforming before making costly optimization mistakes.",
        "author": "Julio Casado",
        "tags": [
            "google-ads",
            "performance-decomposition",
            "attribution-diagnostics",
            "auction-insights"
        ]
    },
    {
        "slug": "google_ads_demand_gen_methodology",
        "name": "Google Ads Demand Gen Methodology",
        "description": "Standardize your Demand Gen analysis with proven frameworks for audience expansion, creative strategy, and lead quality tracking.",
        "category": "Google Ads",
        "systemPrompt": "You are operating the \"Google Ads Demand Gen Methodology\" skill. Standardize your Demand Gen analysis with proven frameworks for audience expansion, creative strategy, and lead quality tracking.",
        "author": "Julio Casado",
        "tags": [
            "google-ads",
            "demand-gen",
            "audience-segmentation",
            "creative"
        ]
    },
    {
        "slug": "google_ads_budget_methodology",
        "name": "Google Ads Budget Methodology",
        "description": "Establish a data-driven foundation for reallocating Google Ads spend to the most efficient marginal opportunities.",
        "category": "Google Ads",
        "systemPrompt": "You are operating the \"Google Ads Budget Methodology\" skill. Establish a data-driven foundation for reallocating Google Ads spend to the most efficient marginal opportunities.",
        "author": "Julio Casado",
        "tags": [
            "google-ads",
            "budget-optimization",
            "marginal-efficiency",
            "budget-pacing"
        ]
    },
    {
        "slug": "google_ads_pmax_methodology",
        "name": "PMax Methodology",
        "description": "Standardize your Performance Max audits with a proven 8-channel breakdown and asset scoring methodology.",
        "category": "Google Ads",
        "systemPrompt": "You are operating the \"PMax Methodology\" skill. Standardize your Performance Max audits with a proven 8-channel breakdown and asset scoring methodology.",
        "author": "Julio Casado",
        "tags": [
            "google-ads",
            "pmax-audit",
            "channel-breakdown",
            "asset-evaluation"
        ]
    },
    {
        "slug": "google_ads_analyze_shopping",
        "name": "Analyze Shopping",
        "description": "Optimize Shopping performance by automatically classifying products into performance tiers and identifying feed improvement opportunities.",
        "category": "Google Ads",
        "systemPrompt": "You are operating the \"Analyze Shopping\" skill. Optimize Shopping performance by automatically classifying products into performance tiers and identifying feed improvement opportunities.",
        "author": "Julio Casado",
        "tags": [
            "google-ads",
            "shopping-ads",
            "product-performance",
            "feed-audit"
        ]
    },
    {
        "slug": "google_ads_shopping_methodology",
        "name": "Shopping Methodology",
        "description": "Standardize Shopping campaign audits with a proven methodology for feed optimization and product performance classification.",
        "category": "Google Ads",
        "systemPrompt": "You are operating the \"Shopping Methodology\" skill. Standardize Shopping campaign audits with a proven methodology for feed optimization and product performance classification.",
        "author": "Julio Casado",
        "tags": [
            "google-ads",
            "shopping-ads",
            "pmax-audit",
            "feed-audit"
        ]
    },
    {
        "slug": "hex-query",
        "name": "Hex Query",
        "description": "Empower teams to get instant, visual data insights and shareable Hex reports directly within their workflow.",
        "category": "Analytics",
        "systemPrompt": "You are operating the \"Hex Query\" skill. Empower teams to get instant, visual data insights and shareable Hex reports directly within their workflow.",
        "author": "",
        "tags": [
            "hex-query",
            "hex",
            "gaql-queries",
            "core-workflow"
        ]
    }
];

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`ALTER TABLE "skills" ADD COLUMN IF NOT EXISTS "slug" character varying(255)`);
    // The unique index must exist before the inserts so `ON CONFLICT (slug)`
    // has an arbiter to infer. Safe to create up front — the column is empty.
    await queryRunner.query(
      `CREATE UNIQUE INDEX IF NOT EXISTS "UQ_skills_slug" ON "skills" ("slug")`,
    );

    for (const skill of this.skills) {
      await queryRunner.query(
        `INSERT INTO "skills" ("slug", "name", "description", "category", "systemPrompt", "author", "tags", "isBundle", "requiredIntegrations")
         VALUES ($1, $2, $3, $4, $5, $6, $7, false, '')
         ON CONFLICT ("slug") DO NOTHING`,
        [
          skill.slug,
          skill.name,
          skill.description,
          skill.category,
          skill.systemPrompt,
          skill.author,
          skill.tags.join(','),
        ],
      );
    }

    await queryRunner.query(`ALTER TABLE "skills" ALTER COLUMN "slug" SET NOT NULL`);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP INDEX IF EXISTS "UQ_skills_slug"`);
    const slugs = this.skills.map((skill) => skill.slug);
    await queryRunner.query(`DELETE FROM "skills" WHERE "slug" = ANY($1)`, [slugs]);
    await queryRunner.query(`ALTER TABLE "skills" DROP COLUMN IF EXISTS "slug"`);
  }
}
