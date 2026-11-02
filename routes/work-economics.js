"use strict";

const express = require("express");

const economics =
  require("../services/mira-work-economics-engine");

function safeAnalyze(query = {}) {
  /*
   * Stage 12.3 is an analysis/accounting layer only.
   *
   * This route must never perform:
   * - money transfer
   * - payment
   * - financial commitment
   * - external purchase
   */
  const result =
    economics.analyzeWorkEconomics({
      filters: query
    });

  return {
    ...result,
    accountingOnly: true,
    moneyTransferEnabled: false,
    financialCommitmentEnabled: false
  };
}

function registerWorkEconomicsRoutes(app) {
  if (
    !app ||
    typeof app.get !== "function"
  ) {
    throw new Error(
      "Express app with get() is required."
    );
  }

  app.get(
    "/api/admin/work-economics",
    (req, res) => {
      try {
        const result =
          safeAnalyze(req.query || {});

        return res.status(200).json(result);
      } catch (error) {
        return res.status(500).json({
          ok: false,
          error:
            "work_economics_analysis_failed",
          message:
            error.message,
          accountingOnly: true,
          moneyTransferEnabled: false,
          financialCommitmentEnabled: false
        });
      }
    }
  );

  return app;
}

module.exports =
  registerWorkEconomicsRoutes;
