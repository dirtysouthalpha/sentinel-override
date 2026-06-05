// tests/platform-modules.test.js
// Direct unit tests for all 18 individual platform profile modules.
// Tests shape validation, detect() positive/negative cases,
// pageTypes/knownSelectors/waitStrings structure, and platform-specific features.

import { sonicwallNsm } from '../background/platforms/sonicwall_nsm.js';
import { sonicwallOnbox } from '../background/platforms/sonicwall_onbox.js';
import { m365Admin } from '../background/platforms/m365_admin.js';
import { fortigate } from '../background/platforms/fortigate.js';
import { itglue } from '../background/platforms/itglue.js';
import { aruba } from '../background/platforms/aruba.js';
import { ambioViewlinc } from '../background/platforms/ambio_viewlinc.js';
import { screenconnect } from '../background/platforms/screenconnect.js';
import { ninjarmm } from '../background/platforms/ninjarmm.js';
import { connectwiseManage } from '../background/platforms/connectwise_manage.js';
import { dattoRmm } from '../background/platforms/datto_rmm.js';
import { cisco } from '../background/platforms/cisco.js';
import { paloalto } from '../background/platforms/paloalto.js';
import { sentinelone } from '../background/platforms/sentinelone.js';
import { nvd } from '../background/platforms/nvd.js';
import { virustotal } from '../background/platforms/virustotal.js';
import { huntress } from '../background/platforms/huntress.js';
import { networkDevice } from '../background/platforms/network_device.js';

const ALL_MODULES = [
  sonicwallNsm, sonicwallOnbox, m365Admin, fortigate, itglue, aruba,
  ambioViewlinc, screenconnect, ninjarmm, connectwiseManage, dattoRmm,
  cisco, paloalto, sentinelone, nvd, virustotal, huntress, networkDevice,
];

// ========== Shared shape validation ==========

describe('Platform modules — shared shape', () => {
  test('all 18 modules are present', () => {
    expect(ALL_MODULES).toHaveLength(18);
  });

  test('no duplicate ids', () => {
    const ids = ALL_MODULES.map(m => m.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  for (const mod of ALL_MODULES) {
    describe(`${mod.id} — shape`, () => {
      test('has id string', () => {
        expect(typeof mod.id).toBe('string');
        expect(mod.id.length).toBeGreaterThan(0);
      });

      test('has label string', () => {
        expect(typeof mod.label).toBe('string');
        expect(mod.label.length).toBeGreaterThan(0);
      });

      test('has memoryKeyPrefix string', () => {
        expect(typeof mod.memoryKeyPrefix).toBe('string');
        expect(mod.memoryKeyPrefix.length).toBeGreaterThan(0);
      });

      test('has detect function', () => {
        expect(typeof mod.detect).toBe('function');
      });

      test('detect returns false for null/undefined url', () => {
        expect(mod.detect(null, 'some goal')).toBe(false);
        expect(mod.detect(undefined, 'some goal')).toBe(false);
      });

      test('detect returns false for empty url with empty goal', () => {
        expect(mod.detect('', '')).toBe(false);
      });

      test('has pageTypes array', () => {
        expect(Array.isArray(mod.pageTypes)).toBe(true);
      });

      test('pageTypes entries have name, urlMatch, hint', () => {
        for (const pt of mod.pageTypes) {
          expect(typeof pt.name).toBe('string');
          expect(pt.name.length).toBeGreaterThan(0);
          expect(pt.urlMatch).toBeInstanceOf(RegExp);
          expect(typeof pt.hint).toBe('string');
          expect(pt.hint.length).toBeGreaterThan(0);
        }
      });

      test('has knownSelectors object', () => {
        expect(typeof mod.knownSelectors).toBe('object');
        expect(mod.knownSelectors).not.toBeNull();
      });

      test('knownSelectors values are strings or functions', () => {
        for (const [key, val] of Object.entries(mod.knownSelectors)) {
          const ok = typeof val === 'string' || typeof val === 'function' || Array.isArray(val);
          if (!ok) {
            throw new Error(`knownSelectors.${key} should be string, function, or array, got ${typeof val}`);
          }
          expect(ok).toBe(true);
        }
      });

      test('has waitStrings object', () => {
        expect(typeof mod.waitStrings).toBe('object');
        expect(mod.waitStrings).not.toBeNull();
      });

      test('waitStrings values are arrays of strings', () => {
        for (const [key, val] of Object.entries(mod.waitStrings)) {
          if (!Array.isArray(val)) {
            throw new Error(`waitStrings.${key} should be array, got ${typeof val}`);
          }
          for (const s of val) {
            expect(typeof s).toBe('string');
          }
        }
      });

      test('has rewriteInstructions string or array of strings if present', () => {
        const val = mod.rewriteInstructions;
        if (val === undefined || val === null) return;
        if (Array.isArray(val)) {
          for (const instr of val) {
            expect(typeof instr).toBe('string');
          }
        } else {
          expect(typeof val).toBe('string');
          expect(val.length).toBeGreaterThan(0);
        }
      });

      test('has workflowHints array', () => {
        expect(Array.isArray(mod.workflowHints)).toBe(true);
      });

      test('workflowHints entries have match RegExp and hint string', () => {
        for (const wh of mod.workflowHints) {
          expect(wh.match).toBeInstanceOf(RegExp);
          expect(typeof wh.hint).toBe('string');
          expect(wh.hint.length).toBeGreaterThan(0);
        }
      });

      test('knownGotchas is a string', () => {
        const val = mod.knownGotchas;
        expect(typeof val === 'string' || Array.isArray(val)).toBe(true);
      });
    });
  }
});

// ========== Per-module detect() tests ==========

describe('sonicwallNsm — detect', () => {
  test('matches nsm.sonicwall.com', () => {
    expect(sonicwallNsm.detect('https://nsm.sonicwall.com/dashboard', '')).toBe(true);
  });

  test('matches cloud.sonicwall.com', () => {
    expect(sonicwallNsm.detect('https://cloud.sonicwall.com/manage', '')).toBe(true);
  });

  test('matches goal text "SonicWall NSM"', () => {
    expect(sonicwallNsm.detect('https://example.com/', 'SonicWall NSM check')).toBe(true);
  });

  test('matches goal text "Network Security Manager"', () => {
    expect(sonicwallNsm.detect('https://example.com/', 'Network Security Manager review')).toBe(true);
  });

  test('does not match generic URL', () => {
    expect(sonicwallNsm.detect('https://example.com/', '')).toBe(false);
  });

  test('does not match on-box IP URL', () => {
    expect(sonicwallNsm.detect('https://192.168.1.1/main.html', '')).toBe(false);
  });
});

describe('sonicwallOnbox — detect', () => {
  test('matches /sonicui/ path on IP host', () => {
    expect(sonicwallOnbox.detect('https://192.168.1.1/sonicui/login', '')).toBe(true);
  });

  test('matches /main.html on IP host', () => {
    expect(sonicwallOnbox.detect('https://10.0.0.1/main.html', '')).toBe(true);
  });

  test('matches /auth.html on IP host', () => {
    expect(sonicwallOnbox.detect('https://10.0.0.1/auth.html', '')).toBe(true);
  });

  test('matches IP-based /dashboard', () => {
    expect(sonicwallOnbox.detect('https://192.168.1.1/dashboard', '')).toBe(true);
  });

  test('matches IP-based /vpn', () => {
    expect(sonicwallOnbox.detect('https://10.0.0.1/vpn', '')).toBe(true);
  });

  test('does not match NSM URLs', () => {
    expect(sonicwallOnbox.detect('https://nsm.sonicwall.com/main.html', '')).toBe(false);
  });

  test('does not match /fmc path (Cisco)', () => {
    expect(sonicwallOnbox.detect('https://192.168.1.1/fmc/dashboard', '')).toBe(false);
  });

  test('does not match /asdm path (Cisco)', () => {
    expect(sonicwallOnbox.detect('https://192.168.1.1/asdm', '')).toBe(false);
  });

  test('matches goal text "SonicOS"', () => {
    expect(sonicwallOnbox.detect('https://example.com/', 'Check SonicOS settings')).toBe(true);
  });

  test('matches goal text "TZ350"', () => {
    expect(sonicwallOnbox.detect('https://example.com/', 'Configure TZ350 VPN')).toBe(true);
  });

  test('matches goal text "NSA4700"', () => {
    expect(sonicwallOnbox.detect('https://example.com/', 'NSA4700 firmware update')).toBe(true);
  });
});

describe('m365Admin — detect', () => {
  test('matches admin.microsoft.com', () => {
    expect(m365Admin.detect('https://admin.microsoft.com/', '')).toBe(true);
  });

  test('matches entra.microsoft.com', () => {
    expect(m365Admin.detect('https://entra.microsoft.com/', '')).toBe(true);
  });

  test('matches admin.exchange.microsoft.com', () => {
    expect(m365Admin.detect('https://admin.exchange.microsoft.com/', '')).toBe(true);
  });

  test('matches security.microsoft.com', () => {
    expect(m365Admin.detect('https://security.microsoft.com/', '')).toBe(true);
  });

  test('matches portal.azure.com', () => {
    expect(m365Admin.detect('https://portal.azure.com/', '')).toBe(true);
  });

  test('matches login.microsoftonline.com', () => {
    expect(m365Admin.detect('https://login.microsoftonline.com/', '')).toBe(true);
  });

  test('matches purview.microsoft.com', () => {
    expect(m365Admin.detect('https://purview.microsoft.com/', '')).toBe(true);
  });

  test('matches intune.microsoft.com', () => {
    expect(m365Admin.detect('https://intune.microsoft.com/', '')).toBe(true);
  });

  test('matches goal text "M365"', () => {
    expect(m365Admin.detect('https://example.com/', 'Check M365 licenses')).toBe(true);
  });

  test('matches goal text "Exchange admin"', () => {
    expect(m365Admin.detect('https://example.com/', 'Open Exchange admin center')).toBe(true);
  });

  test('matches goal text "Entra"', () => {
    expect(m365Admin.detect('https://example.com/', 'Check Entra conditional access')).toBe(true);
  });

  test('does not match generic URL', () => {
    expect(m365Admin.detect('https://example.com/', '')).toBe(false);
  });
});

describe('fortigate — detect', () => {
  test('matches fortinet host', () => {
    expect(fortigate.detect('https://fortinet.example.com/', '')).toBe(true);
  });

  test('matches fortigate host', () => {
    expect(fortigate.detect('https://fortigate.local/', '')).toBe(true);
  });

  test('matches /ng/ path on IP host', () => {
    expect(fortigate.detect('https://192.168.1.1/ng/dashboard', '')).toBe(true);
  });

  test('matches goal text "FortiGate"', () => {
    expect(fortigate.detect('https://example.com/', 'FortiGate VPN tunnel status')).toBe(true);
  });

  test('matches goal text "FortiManager"', () => {
    expect(fortigate.detect('https://example.com/', 'FortiManager install config')).toBe(true);
  });

  test('does not match generic URL', () => {
    expect(fortigate.detect('https://example.com/', '')).toBe(false);
  });
});

describe('itglue — detect', () => {
  test('matches itglue.com', () => {
    expect(itglue.detect('https://company.itglue.com/', '')).toBe(true);
  });

  test('matches partner.itglue.com', () => {
    expect(itglue.detect('https://partner.itglue.com/', '')).toBe(true);
  });

  test('matches goal text "IT Glue"', () => {
    expect(itglue.detect('https://example.com/', 'Look up IT Glue config')).toBe(true);
  });

  test('matches goal text "ITGlue" (no space)', () => {
    expect(itglue.detect('https://example.com/', 'Check ITGlue documentation')).toBe(true);
  });

  test('does not match generic URL', () => {
    expect(itglue.detect('https://example.com/', '')).toBe(false);
  });
});

describe('aruba — detect', () => {
  test('matches central.arubanetworks.com', () => {
    expect(aruba.detect('https://central.arubanetworks.com/dashboard', '')).toBe(true);
  });

  test('matches portal.central.arubanetworks.com', () => {
    expect(aruba.detect('https://portal.central.arubanetworks.com/', '')).toBe(true);
  });

  test('matches Aruba Instant path on IP host', () => {
    expect(aruba.detect('https://192.168.1.1/swarm.html', '')).toBe(true);
  });

  test('matches goal text "Aruba Central"', () => {
    expect(aruba.detect('https://example.com/', 'Aruba Central AP status')).toBe(true);
  });

  test('matches goal text "AOS-CX"', () => {
    expect(aruba.detect('https://example.com/', 'AOS-CX switch config')).toBe(true);
  });

  test('does not match generic URL', () => {
    expect(aruba.detect('https://example.com/', '')).toBe(false);
  });
});

describe('ambioViewlinc — detect', () => {
  test('matches viewlinc host', () => {
    expect(ambioViewlinc.detect('https://viewlinc.local/', '')).toBe(true);
  });

  test('matches 192.168.100.x IP', () => {
    expect(ambioViewlinc.detect('https://192.168.100.10/', '')).toBe(true);
  });

  test('matches goal text "viewLinc"', () => {
    expect(ambioViewlinc.detect('https://example.com/', 'viewLinc threshold check')).toBe(true);
  });

  test('matches goal text "ambio"', () => {
    expect(ambioViewlinc.detect('https://example.com/', 'Check ambio readings')).toBe(true);
  });

  test('does not match 192.168.1.x IP (wrong subnet)', () => {
    expect(ambioViewlinc.detect('https://192.168.1.10/', '')).toBe(false);
  });

  test('does not match generic URL', () => {
    expect(ambioViewlinc.detect('https://example.com/', '')).toBe(false);
  });
});

describe('screenconnect — detect', () => {
  test('matches screenconnect.com host', () => {
    expect(screenconnect.detect('https://my.screenconnect.com/Host#Access', '')).toBe(true);
  });

  test('matches connectwise.com host', () => {
    expect(screenconnect.detect('https://my.connectwise.com/Host#Access', '')).toBe(true);
  });

  test('matches /Host#Support path on any host', () => {
    expect(screenconnect.detect('https://remote.example.com/Host#Support', '')).toBe(true);
  });

  test('matches goal text "ScreenConnect"', () => {
    expect(screenconnect.detect('https://example.com/', 'Connect via ScreenConnect')).toBe(true);
  });

  test('does not match generic URL', () => {
    expect(screenconnect.detect('https://example.com/', '')).toBe(false);
  });
});

describe('ninjarmm — detect', () => {
  test('matches ninjarmm.com', () => {
    expect(ninjarmm.detect('https://app.ninjarmm.com/', '')).toBe(true);
  });

  test('matches ninjarmm.io', () => {
    expect(ninjarmm.detect('https://app.ninjarmm.io/', '')).toBe(true);
  });

  test('matches goal text "NinjaRMM"', () => {
    expect(ninjarmm.detect('https://example.com/', 'NinjaRMM device check')).toBe(true);
  });

  test('matches goal text "NinjaOne"', () => {
    expect(ninjarmm.detect('https://example.com/', 'NinjaOne alert review')).toBe(true);
  });

  test('does not match generic URL', () => {
    expect(ninjarmm.detect('https://example.com/', '')).toBe(false);
  });
});

describe('connectwiseManage — detect', () => {
  test('matches my.connectwise.com', () => {
    expect(connectwiseManage.detect('https://my.connectwise.com/', '')).toBe(true);
  });

  test('matches goal text "ConnectWise Manage"', () => {
    expect(connectwiseManage.detect('https://example.com/', 'ConnectWise Manage ticket')).toBe(true);
  });

  test('matches goal text "CW Manage"', () => {
    expect(connectwiseManage.detect('https://example.com/', 'CW Manage create ticket')).toBe(true);
  });

  test('does not match generic URL', () => {
    expect(connectwiseManage.detect('https://example.com/', '')).toBe(false);
  });
});

describe('dattoRmm — detect', () => {
  test('matches centrastage.net', () => {
    expect(dattoRmm.detect('https://company.centrastage.net/', '')).toBe(true);
  });

  test('matches dattormm.com', () => {
    expect(dattoRmm.detect('https://company.dattormm.com/', '')).toBe(true);
  });

  test('matches autotask.net', () => {
    expect(dattoRmm.detect('https://company.autotask.net/', '')).toBe(true);
  });

  test('matches goal text "Datto RMM"', () => {
    expect(dattoRmm.detect('https://example.com/', 'Datto RMM device status')).toBe(true);
  });

  test('matches goal text "Autotask"', () => {
    expect(dattoRmm.detect('https://example.com/', 'Autotask ticket review')).toBe(true);
  });

  test('does not match generic URL', () => {
    expect(dattoRmm.detect('https://example.com/', '')).toBe(false);
  });
});

describe('cisco — detect', () => {
  test('matches cisco.com', () => {
    expect(cisco.detect('https://app.cisco.com/', '')).toBe(true);
  });

  test('matches meraki.com', () => {
    expect(cisco.detect('https://dashboard.meraki.com/', '')).toBe(true);
  });

  test('matches /fmc path on IP host', () => {
    expect(cisco.detect('https://192.168.1.1/fmc/dashboard', '')).toBe(true);
  });

  test('matches /asdm path on IP host', () => {
    expect(cisco.detect('https://192.168.1.1/asdm', '')).toBe(true);
  });

  test('matches goal text "Cisco ASA"', () => {
    expect(cisco.detect('https://example.com/', 'Cisco ASA config check')).toBe(true);
  });

  test('matches goal text "Meraki"', () => {
    expect(cisco.detect('https://example.com/', 'Meraki switch status')).toBe(true);
  });

  test('matches goal text "Firepower"', () => {
    expect(cisco.detect('https://example.com/', 'Firepower policy update')).toBe(true);
  });

  test('does not match generic URL', () => {
    expect(cisco.detect('https://example.com/', '')).toBe(false);
  });
});

describe('paloalto — detect', () => {
  test('matches paloalto host', () => {
    expect(paloalto.detect('https://paloalto.local/', '')).toBe(true);
  });

  test('matches panorama host', () => {
    expect(paloalto.detect('https://panorama.local/', '')).toBe(true);
  });

  test('matches goal text "Palo Alto"', () => {
    expect(paloalto.detect('https://example.com/', 'Palo Alto firewall rules')).toBe(true);
  });

  test('matches goal text "PAN-OS"', () => {
    expect(paloalto.detect('https://example.com/', 'PAN-OS commit')).toBe(true);
  });

  test('matches goal text "Panorama"', () => {
    expect(paloalto.detect('https://example.com/', 'Panorama device push')).toBe(true);
  });

  test('does not match generic URL', () => {
    expect(paloalto.detect('https://example.com/', '')).toBe(false);
  });
});

describe('sentinelone — detect', () => {
  test('matches sentinelone.net', () => {
    expect(sentinelone.detect('https://company.sentinelone.net/', '')).toBe(true);
  });

  test('matches .sentinelone.com', () => {
    expect(sentinelone.detect('https://usea1.sentinelone.com/', '')).toBe(true);
  });

  test('matches goal text "SentinelOne"', () => {
    expect(sentinelone.detect('https://example.com/', 'SentinelOne threat search')).toBe(true);
  });

  test('matches goal text "Singularity"', () => {
    expect(sentinelone.detect('https://example.com/', 'Singularity console')).toBe(true);
  });

  test('does not match generic URL', () => {
    expect(sentinelone.detect('https://example.com/', '')).toBe(false);
  });
});

describe('nvd — detect', () => {
  test('matches nvd.nist.gov', () => {
    expect(nvd.detect('https://nvd.nist.gov/vuln/search', '')).toBe(true);
  });

  test('matches cve.mitre.org', () => {
    expect(nvd.detect('https://cve.mitre.org/', '')).toBe(true);
  });

  test('matches cve.org', () => {
    expect(nvd.detect('https://cve.org/', '')).toBe(true);
  });

  test('matches goal text "NVD"', () => {
    expect(nvd.detect('https://example.com/', 'Check NVD for CVE')).toBe(true);
  });

  test('matches goal text "CVE search"', () => {
    expect(nvd.detect('https://example.com/', 'CVE search for Apache')).toBe(true);
  });

  test('does not match generic URL', () => {
    expect(nvd.detect('https://example.com/', '')).toBe(false);
  });
});

describe('virustotal — detect', () => {
  test('matches virustotal.com', () => {
    expect(virustotal.detect('https://www.virustotal.com/gui/file/abc', '')).toBe(true);
  });

  test('matches goal text "VirusTotal"', () => {
    expect(virustotal.detect('https://example.com/', 'VirusTotal hash lookup')).toBe(true);
  });

  test('matches goal text "VT API"', () => {
    expect(virustotal.detect('https://example.com/', 'Use VT API')).toBe(true);
  });

  test('does not match generic URL', () => {
    expect(virustotal.detect('https://example.com/', '')).toBe(false);
  });
});

describe('huntress — detect', () => {
  test('matches huntress host', () => {
    expect(huntress.detect('https://company.huntress.io/', '')).toBe(true);
  });

  test('matches goal text "Huntress"', () => {
    expect(huntress.detect('https://example.com/', 'Huntress alert review')).toBe(true);
  });

  test('does not match generic URL', () => {
    expect(huntress.detect('https://example.com/', '')).toBe(false);
  });
});

describe('networkDevice — detect', () => {
  test('matches goal text "firewall"', () => {
    expect(networkDevice.detect('https://example.com/', 'Check firewall rules')).toBe(true);
  });

  test('matches goal text "router"', () => {
    expect(networkDevice.detect('https://example.com/', 'Router config backup')).toBe(true);
  });

  test('matches goal text "switch"', () => {
    expect(networkDevice.detect('https://example.com/', 'Switch VLAN config')).toBe(true);
  });

  test('matches goal text "access point"', () => {
    expect(networkDevice.detect('https://example.com/', 'Access point status')).toBe(true);
  });

  test('matches goal text "admin panel"', () => {
    expect(networkDevice.detect('https://example.com/', 'Device admin panel')).toBe(true);
  });

  test('does not match generic goal', () => {
    expect(networkDevice.detect('https://example.com/', 'Check email settings')).toBe(false);
  });

  test('ignores URL entirely (goal-only detection)', () => {
    expect(networkDevice.detect('https://192.168.1.1/', '')).toBe(false);
  });
});

// ========== Platform-specific features ==========

describe('sonicwallNsm — features', () => {
  test('has needsTargetSelection true', () => {
    expect(sonicwallNsm.needsTargetSelection).toBe(true);
  });

  test('has preflightInstructions string', () => {
    expect(typeof sonicwallNsm.preflightInstructions).toBe('string');
    expect(sonicwallNsm.preflightInstructions.length).toBeGreaterThan(0);
  });

  test('has mismatchHints array with 9 entries', () => {
    expect(Array.isArray(sonicwallNsm.mismatchHints)).toBe(true);
    expect(sonicwallNsm.mismatchHints).toHaveLength(9);
  });

  test('mismatchHints entries have pattern, onbox, nsm', () => {
    for (const hint of sonicwallNsm.mismatchHints) {
      expect(hint.pattern).toBeInstanceOf(RegExp);
      expect(typeof hint.onbox).toBe('string');
      expect(typeof hint.nsm).toBe('string');
    }
  });

  test('has liveDataCaveats string', () => {
    expect(typeof sonicwallNsm.liveDataCaveats).toBe('string');
  });
});

describe('sonicwallOnbox — features', () => {
  test('has needsTargetSelection false', () => {
    expect(sonicwallOnbox.needsTargetSelection).toBe(false);
  });

  test('has commandInterface', () => {
    expect(sonicwallOnbox.commandInterface).toBeDefined();
    expect(typeof sonicwallOnbox.commandInterface.inputSelector).toBe('string');
    expect(typeof sonicwallOnbox.commandInterface.outputTimeoutMs).toBe('number');
  });

  test('has mismatchHints empty', () => {
    expect(sonicwallOnbox.mismatchHints).toEqual([]);
  });
});

describe('m365Admin — features', () => {
  test('has inferSurface function', () => {
    expect(typeof m365Admin.inferSurface).toBe('function');
  });

  test('inferSurface returns "exchange" for mail flow goals', () => {
    expect(m365Admin.inferSurface('message trace for user@example.com')).toBe('exchange');
  });

  test('inferSurface returns "entra" for sign-in goals', () => {
    expect(m365Admin.inferSurface('check sign-in logs')).toBe('entra');
  });

  test('inferSurface returns "entra" for conditional access', () => {
    expect(m365Admin.inferSurface('conditional access policy')).toBe('entra');
  });

  test('inferSurface returns "purview" for audit log goals', () => {
    expect(m365Admin.inferSurface('audit log search')).toBe('purview');
  });

  test('inferSurface returns "purview" for DLP goals', () => {
    expect(m365Admin.inferSurface('DLP policy review')).toBe('purview');
  });

  test('inferSurface returns "defender" for threat hunting', () => {
    expect(m365Admin.inferSurface('advanced hunting KQL')).toBe('defender');
  });

  test('inferSurface returns "intune" for device config', () => {
    expect(m365Admin.inferSurface('Intune device compliance')).toBe('intune');
  });

  test('inferSurface returns "admin" for generic goals', () => {
    expect(m365Admin.inferSurface('add a new user')).toBe('admin');
  });

  test('has surfaceUrls object with all 6 surfaces', () => {
    expect(Object.keys(m365Admin.surfaceUrls)).toEqual(
      expect.arrayContaining(['admin', 'entra', 'exchange', 'purview', 'defender', 'intune'])
    );
  });

  test('has mismatchHints array with 3 entries', () => {
    expect(m365Admin.mismatchHints).toHaveLength(3);
  });

  test('has needsTargetSelection false', () => {
    expect(m365Admin.needsTargetSelection).toBe(false);
  });
});

describe('fortigate — features', () => {
  test('has commandInterface', () => {
    expect(fortigate.commandInterface).toBeDefined();
    expect(fortigate.commandInterface.submitSelector).toBeNull();
    expect(typeof fortigate.commandInterface.outputTimeoutMs).toBe('number');
  });

  test('has 5 workflowHints', () => {
    expect(fortigate.workflowHints).toHaveLength(5);
  });

  test('has needsTargetSelection false', () => {
    expect(fortigate.needsTargetSelection).toBe(false);
  });
});

describe('itglue — features', () => {
  test('has needsTargetSelection true', () => {
    expect(itglue.needsTargetSelection).toBe(true);
  });

  test('has preflightInstructions', () => {
    expect(typeof itglue.preflightInstructions).toBe('string');
    expect(itglue.preflightInstructions.length).toBeGreaterThan(0);
  });

  test('has 5 workflowHints', () => {
    expect(itglue.workflowHints).toHaveLength(5);
  });
});

describe('aruba — features', () => {
  test('has needsTargetSelection true', () => {
    expect(aruba.needsTargetSelection).toBe(true);
  });

  test('has preflightInstructions', () => {
    expect(typeof aruba.preflightInstructions).toBe('string');
    expect(aruba.preflightInstructions.length).toBeGreaterThan(0);
  });

  test('has 4 workflowHints', () => {
    expect(aruba.workflowHints).toHaveLength(4);
  });
});

describe('ambioViewlinc — features', () => {
  test('has needsTargetSelection true', () => {
    expect(ambioViewlinc.needsTargetSelection).toBe(true);
  });

  test('has mismatchHints array with 4 entries', () => {
    expect(ambioViewlinc.mismatchHints).toHaveLength(4);
  });

  test('rewriteInstructions is array of strings', () => {
    expect(Array.isArray(ambioViewlinc.rewriteInstructions)).toBe(true);
    expect(ambioViewlinc.rewriteInstructions.length).toBeGreaterThan(0);
    for (const instr of ambioViewlinc.rewriteInstructions) {
      expect(typeof instr).toBe('string');
    }
  });

  test('has 4 workflowHints', () => {
    expect(ambioViewlinc.workflowHints).toHaveLength(4);
  });
});

describe('screenconnect — features', () => {
  test('has commandInterface', () => {
    expect(screenconnect.commandInterface).toBeDefined();
    expect(screenconnect.commandInterface.outputReadyText).toBeNull();
    expect(typeof screenconnect.commandInterface.outputTimeoutMs).toBe('number');
  });

  test('has commitFlow empty array', () => {
    expect(screenconnect.commitFlow).toEqual([]);
  });

  test('has sessionExpiredText', () => {
    expect(typeof screenconnect.sessionExpiredText).toBe('string');
  });

  test('has 4 workflowHints', () => {
    expect(screenconnect.workflowHints).toHaveLength(4);
  });
});

describe('ninjarmm — features', () => {
  test('has commandInterface', () => {
    expect(ninjarmm.commandInterface).toBeDefined();
    expect(typeof ninjarmm.commandInterface.outputReadyText).toBe('string');
    expect(typeof ninjarmm.commandInterface.outputTimeoutMs).toBe('number');
    expect(typeof ninjarmm.commandInterface.commandTypes).toBe('object');
  });

  test('commandTypes has powershell, cmd, bash', () => {
    expect(ninjarmm.commandInterface.commandTypes).toHaveProperty('powershell');
    expect(ninjarmm.commandInterface.commandTypes).toHaveProperty('cmd');
    expect(ninjarmm.commandInterface.commandTypes).toHaveProperty('bash');
  });

  test('has commitFlow', () => {
    expect(Array.isArray(ninjarmm.commitFlow)).toBe(true);
  });

  test('has sessionExpiredText', () => {
    expect(typeof ninjarmm.sessionExpiredText).toBe('string');
  });

  test('has 5 workflowHints', () => {
    expect(ninjarmm.workflowHints).toHaveLength(5);
  });
});

describe('connectwiseManage — features', () => {
  test('has commitFlow', () => {
    expect(connectwiseManage.commitFlow).toEqual(['Save', 'OK']);
  });

  test('has sessionExpiredText', () => {
    expect(typeof connectwiseManage.sessionExpiredText).toBe('string');
  });

  test('has mismatchHints with 1 entry', () => {
    expect(connectwiseManage.mismatchHints).toHaveLength(1);
  });

  test('has 5 workflowHints', () => {
    expect(connectwiseManage.workflowHints).toHaveLength(5);
  });
});

describe('dattoRmm — features', () => {
  test('has commandInterface', () => {
    expect(dattoRmm.commandInterface).toBeDefined();
    expect(typeof dattoRmm.commandInterface.outputReadyText).toBe('string');
    expect(typeof dattoRmm.commandInterface.outputTimeoutMs).toBe('number');
  });

  test('has commitFlow', () => {
    expect(dattoRmm.commitFlow).toEqual(['Save', 'Apply']);
  });

  test('has sessionExpiredText', () => {
    expect(typeof dattoRmm.sessionExpiredText).toBe('string');
  });

  test('has mismatchHints with 1 entry', () => {
    expect(dattoRmm.mismatchHints).toHaveLength(1);
  });

  test('has 5 workflowHints', () => {
    expect(dattoRmm.workflowHints).toHaveLength(5);
  });
});

describe('cisco — features', () => {
  test('has inferSurface function', () => {
    expect(typeof cisco.inferSurface).toBe('function');
  });

  test('inferSurface returns "meraki" for Meraki goals', () => {
    expect(cisco.inferSurface('Check Meraki dashboard')).toBe('meraki');
  });

  test('inferSurface returns "fmc" for Firepower goals', () => {
    expect(cisco.inferSurface('Firepower Management Center')).toBe('fmc');
  });

  test('inferSurface returns "ise" for ISE goals', () => {
    expect(cisco.inferSurface('Cisco ISE policy')).toBe('ise');
  });

  test('inferSurface returns "asdm" for ASA goals', () => {
    expect(cisco.inferSurface('ASDM config check')).toBe('asdm');
  });

  test('inferSurface defaults to "fmc"', () => {
    expect(cisco.inferSurface('check cisco firewall')).toBe('fmc');
  });

  test('has surfaceUrls object', () => {
    expect(typeof cisco.surfaceUrls).toBe('object');
    expect(cisco.surfaceUrls).toHaveProperty('meraki');
  });

  test('has empty workflowHints', () => {
    expect(cisco.workflowHints).toEqual([]);
  });
});

describe('paloalto — features', () => {
  test('has commitFlow with Commit', () => {
    expect(paloalto.commitFlow).toEqual(['Commit']);
  });

  test('has empty workflowHints', () => {
    expect(paloalto.workflowHints).toEqual([]);
  });

  test('has needsTargetSelection false', () => {
    expect(paloalto.needsTargetSelection).toBe(false);
  });
});

describe('sentinelone — features', () => {
  test('has 3 workflowHints', () => {
    expect(sentinelone.workflowHints).toHaveLength(3);
  });

  test('has mismatchHints empty', () => {
    expect(sentinelone.mismatchHints).toEqual([]);
  });

  test('has needsTargetSelection false', () => {
    expect(sentinelone.needsTargetSelection).toBe(false);
  });
});

describe('nvd — features', () => {
  test('has empty workflowHints', () => {
    expect(nvd.workflowHints).toEqual([]);
  });

  test('has needsTargetSelection false', () => {
    expect(nvd.needsTargetSelection).toBe(false);
  });
});

describe('virustotal — features', () => {
  test('has empty workflowHints', () => {
    expect(virustotal.workflowHints).toEqual([]);
  });

  test('has needsTargetSelection false', () => {
    expect(virustotal.needsTargetSelection).toBe(false);
  });
});

describe('huntress — features', () => {
  test('has empty workflowHints', () => {
    expect(huntress.workflowHints).toEqual([]);
  });

  test('has needsTargetSelection false', () => {
    expect(huntress.needsTargetSelection).toBe(false);
  });
});

describe('networkDevice — features', () => {
  test('has empty pageTypes', () => {
    expect(networkDevice.pageTypes).toEqual([]);
  });

  test('has empty workflowHints', () => {
    expect(networkDevice.workflowHints).toEqual([]);
  });

  test('has needsTargetSelection false', () => {
    expect(networkDevice.needsTargetSelection).toBe(false);
  });

  test('has needsTargetSelection defined', () => {
    expect(networkDevice).toHaveProperty('needsTargetSelection');
  });
});

// ========== Registration order test ==========

describe('Platform registration order', () => {
  test('more-specific profiles come before fallbacks', () => {
    const ids = ALL_MODULES.map(m => m.id);
    // SonicWall NSM before on-box
    expect(ids.indexOf('sonicwall_nsm')).toBeLessThan(ids.indexOf('sonicwall_onbox'));
    // networkDevice is last (catch-all)
    expect(ids.indexOf('network_device')).toBe(ids.length - 1);
  });
});

// ========== findMismatchHints integration ==========

describe('findMismatchHints integration', () => {
  test('returns hints for NSM mismatch on "System > Licenses"', async () => {
    const { findMismatchHints } = await import('../background/platforms/index.js');
    const hints = findMismatchHints(sonicwallNsm, 'Check System > Licenses');
    expect(hints.length).toBeGreaterThan(0);
    expect(hints[0].onbox).toContain('System > Licenses');
    expect(hints[0].target).toBeDefined();
  });

  test('returns empty array for on-box (no mismatchHints)', async () => {
    const { findMismatchHints } = await import('../background/platforms/index.js');
    const hints = findMismatchHints(sonicwallOnbox, 'System > Licenses');
    expect(hints).toEqual([]);
  });

  test('returns hints for M365 message trace goal', async () => {
    const { findMismatchHints } = await import('../background/platforms/index.js');
    const hints = findMismatchHints(m365Admin, 'Run a message trace');
    expect(hints.length).toBeGreaterThan(0);
  });
});

// ========== Edge cases ==========

describe('detect() edge cases', () => {
  for (const mod of ALL_MODULES) {
    test(`${mod.id} handles invalid URLs gracefully`, () => {
      // Should not throw for malformed URLs
      expect(() => mod.detect('not-a-url', '')).not.toThrow();
      expect(() => mod.detect('://', '')).not.toThrow();
    });

    test(`${mod.id} handles non-string goal gracefully`, () => {
      expect(() => mod.detect('https://example.com/', null)).not.toThrow();
      expect(() => mod.detect('https://example.com/', undefined)).not.toThrow();
      expect(() => mod.detect('https://example.com/', 12345)).not.toThrow();
    });
  }
});
