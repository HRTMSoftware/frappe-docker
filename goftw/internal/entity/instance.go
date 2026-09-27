package entity

import (
	"encoding/json"
	"fmt"
	"os"
)

// AppSource describes where an app should be fetched from. A string value is
// also accepted for backwards compatibility with older instance.json files.
type AppSource struct {
	Repository string `json:"repository"`
	TokenEnv   string `json:"token_env,omitempty"`
}

func (s *AppSource) UnmarshalJSON(data []byte) error {
	var repository string
	if err := json.Unmarshal(data, &repository); err == nil {
		s.Repository = repository
		return nil
	}
	type appSource AppSource
	var source appSource
	if err := json.Unmarshal(data, &source); err != nil {
		return fmt.Errorf("app source must be a repository string or object: %w", err)
	}
	*s = AppSource(source)
	return nil
}

type Instance struct {
	Deployment         string               `json:"deployment"`
	ServerName         string               `json:"server_name"`
	FrappeBranch       string               `json:"frappe_branch"`
	BenchName          string               `json:"frappe_bench"`
	AppRefs            map[string]string    `json:"app_refs"`
	AppSources         map[string]AppSource `json:"app_sources"`
	DropAbandonedSites bool                 `json:"drop_abandoned_sites"`
	RunSitesManager    bool                 `json:"run_sites_manager"`
	Sites              []Site               `json:"instance_sites"`
}

// LoadInstance loads and parses instance.json
func LoadInstance(path string) (*Instance, error) {
	data, err := os.ReadFile(path)
	if err != nil {
		return nil, err
	}
	var cfg Instance
	if err := json.Unmarshal(data, &cfg); err != nil {
		return nil, err
	}
	if cfg.FrappeBranch == "" {
		cfg.FrappeBranch = "develop"
	}
	if cfg.BenchName == "" {
		cfg.BenchName = "frappe-bench"
	}
	if cfg.Deployment == "" {
		cfg.Deployment = "develop"
	}
	return &cfg, nil
}
