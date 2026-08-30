package main

import (
	"encoding/json"
	"fmt"
	"os"
	"strings"
	"time"

	emailverifier "github.com/AfterShip/email-verifier"
)

type Output struct {
	Email        string  `json:"email"`
	Valid        bool    `json:"valid"`
	SyntaxValid  bool    `json:"syntax_valid"`
	HasMxRecords bool    `json:"has_mx_records"`
	SMTPVerified bool    `json:"smtp_verified"`
	Reachable    string  `json:"reachable"`
	Disposable   bool    `json:"disposable"`
	RoleAccount  bool    `json:"role_account"`
	FreeProvider bool    `json:"free_provider"`
	CatchAll     bool    `json:"catch_all"`
	Suggestion   *string `json:"suggestion"`
	Decision     string  `json:"decision"`
	Reason       string  `json:"reason"`
}

func main() {
	if len(os.Args) < 2 {
		fmt.Println(`{"email":"","valid":false,"decision":"block","reason":"Email argument required"}`)
		os.Exit(1)
	}

	email := strings.TrimSpace(os.Args[1])
	if email == "" {
		fmt.Println(`{"email":"","valid":false,"decision":"block","reason":"Empty email address"}`)
		os.Exit(1)
	}

	fromEmail := os.Getenv("DNS_RETURN_PATH_DOMAIN")
	if fromEmail == "" {
		fromEmail = os.Getenv("DNS_SPF_INCLUDE")
	}
	if fromEmail == "" {
		fromEmail = "noblecircle.online"
	}
	if !strings.Contains(fromEmail, "@") {
		fromEmail = "verifier@" + fromEmail
	}

	helloName := os.Getenv("DNS_HELO_HOSTNAME")
	if helloName == "" {
		helloName = "live.noblecircle.online"
	}

	v := emailverifier.NewVerifier().
		FromEmail(fromEmail).
		HelloName(helloName).
		EnableSMTPCheck().
		EnableDomainSuggest().
		ConnectTimeout(5 * time.Second).
		OperationTimeout(5 * time.Second)

	res, _ := v.Verify(email)

	out := Output{
		Email:     email,
		Reachable: "unknown",
	}

	if res != nil {
		out.SyntaxValid = res.Syntax.Valid
		out.HasMxRecords = res.HasMxRecords
		out.Disposable = res.Disposable
		out.RoleAccount = res.RoleAccount
		out.FreeProvider = res.Free
		out.Reachable = res.Reachable

		if res.Suggestion != "" {
			s := res.Suggestion
			out.Suggestion = &s
		} else if res.Syntax.Suggestion != "" {
			s := res.Syntax.Suggestion
			out.Suggestion = &s
		}

		if res.SMTP != nil {
			out.SMTPVerified = true
			out.CatchAll = res.SMTP.CatchAll
		}
	}

	if out.Reachable == "" {
		out.Reachable = "unknown"
	}

	// ─── Policy Rules ───
	// 1. BLOCK clearly invalid
	if res != nil && !res.Syntax.Valid {
		out.Valid = false
		out.Decision = "block"
		out.Reason = "Invalid email syntax"
	} else if res != nil && !res.HasMxRecords {
		out.Valid = false
		out.Decision = "block"
		out.Reason = "Domain has no MX records"
	} else if res != nil && res.Disposable {
		out.Valid = false
		out.Decision = "block"
		out.Reason = "Disposable email address"
	} else if res != nil && (res.Reachable == "no" || (res.SMTP != nil && res.SMTP.Disabled)) {
		out.Valid = false
		out.Decision = "block"
		out.Reason = "Recipient mailbox confirmed nonexistent"
	} else {
		// 2. ALLOW: Valid, Catch-All, or Unknown reachability
		out.Valid = true
		out.Decision = "allow"
		if res != nil && res.Reachable == "yes" {
			out.Reason = "Recipient address verified and deliverable"
		} else if out.CatchAll {
			out.Reason = "Catch-all domain accepted"
		} else if out.Reachable == "unknown" {
			out.Reason = "Address syntax and MX valid (unknown SMTP status allowed)"
		} else {
			out.Reason = "Recipient address passed verification"
		}
	}

	json.NewEncoder(os.Stdout).Encode(out)
}
