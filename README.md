Fin-coach — Runway: Local-First Financial Wellness Coach

1. Chosen Vertical: Personal Finance & Financial Wellness

Runway belongs to the FinTech – Personal Finance and Financial Wellness vertical.

Problem identified

Many individuals track their income and expenses but struggle to understand how long their available money will last, which recurring expenses are reducing their savings, and whether their current spending habits support their future financial goals.

Traditional expense trackers primarily show historical spending. Runway goes further by converting financial transaction data into forward-looking cash-flow insights.

Our solution

Runway is a privacy-first financial wellness coach designed for individuals managing Indian bank accounts, credit cards and UPI transactions.

It helps users:

- Understand their essential and flexible spending.
- Estimate their survival and lifestyle runway.
- Identify recurring payments and potential unnecessary expenses.
- Track spending patterns and financial goals.
- Simulate financial situations before making decisions.
- Receive actionable insights through personalized nudges.

The objective is not simply to track money, but to help users understand and improve their financial decisions.

2. Approach and Logic

Runway follows a local-first, deterministic and explainable approach.

Instead of relying entirely on AI to interpret financial data, the application combines rule-based processing, mathematical calculations and specialized agents.

A. Data ingestion and preprocessing

Users can import financial information through:

- CSV and Excel bank statements.
- PDF bank statements.
- Pasted SMS transaction messages.

The application extracts transaction details, identifies merchants, categorizes transactions and detects duplicates.

Transactions that cannot be confidently classified are sent for manual review.

B. Transaction classification and learning

A built-in classification system assigns categories to transactions.

Users can correct incorrect classifications by creating custom rules based on transaction descriptions, merchant names or UPI IDs.

These rules are applied to historical transactions and future imports.

C. Financial analysis

The application separates spending into:

- Essentials: rent, EMIs, utilities, groceries and other necessary expenses.
- Flexible spending: dining, shopping, entertainment, travel and subscriptions.

It then calculates financial indicators using a deterministic financial engine.

D. Predictive scenario simulation

Users can explore hypothetical situations such as:

- Reducing dining expenses.
- Increasing rent or EMI payments.
- Cancelling recurring expenses.
- Managing an emergency expense.
- Experiencing temporary unemployment.

The simulator compares the financial position before and after a proposed change.

E. Explainable insights

Rather than presenting unexplained recommendations, Runway provides the underlying figures, calculation methods, assumptions and limitations.

AI agents can assist with interpreting user questions and planning tool calls, but financial calculations remain within the deterministic engine.

3. How the Solution Works

The overall workflow is:

1. Input: The user imports financial statements or manually enters their financial profile.
2. Extraction: Transaction information is extracted from supported formats.
3. Cleaning: Duplicates, transfers, card payments and other transaction patterns are handled.
4. Classification: Transactions are categorized using built-in logic and user-defined rules.
5. Reconciliation: Statement balances and transaction totals are validated wherever the required information is available.
6. Analysis: The financial engine calculates essential spending, flexible spending, surplus and runway.
7. Insights: Recurring expenses, spending drift and potential financial leaks are identified.
8. Simulation: Users evaluate alternative financial scenarios.
9. Action: The application presents relevant nudges, goal updates and monthly reviews.

Core financial calculations

Survival Runway

Cash ÷ Essential Monthly Burn

Lifestyle Runway

Cash ÷ (Essential Monthly Burn + Flexible Monthly Spending)

Monthly Surplus

Monthly Take-home Income − Essential Spending − Flexible Spending

Months to Financial Goal

(Target Amount − Current Savings) ÷ Monthly Contribution

These calculations are based on the available transaction history and user-provided financial information. They are estimates, not guarantees of future financial outcomes.

4. Assumptions Made

The solution uses the following assumptions and limitations:

1. Imported bank statements and transaction messages are assumed to be supplied by the user and may require manual verification.
2. Unknown debit transactions are conservatively treated as flexible spending until reviewed.
3. Transfers between a user's own accounts should not be treated as actual expenses or income.
4. Credit card bill payments are excluded from spending calculations when identified, to avoid double-counting transactions already recorded in the card statement.
5. Recurring payment detection is based on transaction patterns and available mandate indicators. Repeated payments do not automatically prove an active subscription or mandate.
6. Financial projections assume that historical spending patterns are reasonably representative unless the user changes the scenario.
7. PDF extraction depends on selectable text. Scanned documents are not currently supported through OCR.
8. The application provides educational financial insights, not regulated investment, lending, tax or securities advice.
9. Financial data is stored locally in the browser using IndexedDB. It is not automatically synchronized to a cloud account.

5. Evaluation Focus Areas

A. Code Quality

- Modular architecture separates transaction ingestion, financial calculations, storage and user-interface components.
- The financial model uses a deterministic processing function.
- Reusable transaction-processing and classification logic improves maintainability.
- TypeScript supports structured data handling and reduces avoidable type-related errors.

B. Security

- Financial processing happens locally in the browser.
- No bank login credentials or SMS permissions are required.
- No central financial-data server or analytics pipeline is used.
- Sensitive transaction information is not sent to an external AI service.
- Optional AI functionality requires user consent and an API key, with restricted information sharing.
- Product recommendations and lending-related advice are restricted by application guardrails.

Security consideration: Local browser storage is not automatically encrypted. Users should understand this limitation and maintain secure backups.

C. Efficiency

- A deterministic financial engine avoids unnecessary AI calls for mathematical operations.
- Transaction rules are reused across historical and newly imported data.
- Memoized calculations help avoid unnecessary recomputation.
- IndexedDB supports persistent local transaction storage.
- The application is designed to process financial data without depending on continuous server communication.

D. Testing

The project includes automated tests using Vitest.

The test suite covers:

- Financial calculation logic.
- Transaction parsing and ingestion.
- Classification and correction rules.
- Statement reconciliation.
- Recurring payment detection.
- Application requirements.
- Agent execution and guardrails.
- Sample transaction processing.

Current repository documentation reports 135 automated tests.

Run the tests using:

npm test

Build and type-check using:

npm run build

E. Accessibility

The application aims to make financial information understandable to users with different levels of financial and technical knowledge.

Design considerations include:

- Consistent terminology across financial screens.
- Clear explanations of financial metrics and calculations.
- Descriptive labels for financial indicators.
- Understandable alerts instead of unexplained warnings.
- Clear distinction between actual financial data and simulated results.

Further accessibility validation should include keyboard navigation, screen-reader compatibility, sufficient colour contrast and responsive layouts.

F. Problem Statement Alignment

Runway addresses the gap between conventional expense tracking and actionable financial planning.

Its key contribution is combining:

- Financial transaction analysis.
- Personalized spending insights.
- Recurring expense detection.
- Cash-flow forecasting.
- What-if financial simulations.
- Explainable, privacy-conscious recommendations.

By combining these capabilities in a local-first application, Runway aims to help individuals make more informed financial decisions without surrendering control of their financial data.

6. Limitations and Future Scope

Potential improvements include:

- OCR support for scanned bank statements.
- Broader validation against real-world Indian bank statement formats.
- More sophisticated transaction classification.
- Improved recurring payment and subscription detection.
- Accessibility testing and refinements.
- Optional encrypted synchronization and backup.
- Additional financial scenarios and planning tools.

Runway is designed as a financial wellness and educational tool. Its calculations and insights should be independently reviewed before being used for important financial decisions.

---

Project: Fin-coach – Runway
Vertical: FinTech / Personal Finance
Architecture: Local-first, browser-based financial processing
Core approach: Deterministic financial engine + explainable AI-assisted workflows
Repository: https://github.com/Jos-zenith/Fin-coach
