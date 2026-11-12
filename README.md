# Enterprise Network Governance Lab

An Arabic browser-based training lab that starts from an enterprise network and traces a control from simulated traffic through policy, procedure, evidence, RACI, and KPIs.

## Run locally

Open `index.html` in a browser. The lab has no package installation or build step. It can also be served as static files.

1. Inspect the interactive network nodes and their addresses or services.
2. Predict and run the four connection scenarios.
3. Review expected and observed results and their evidence in the simulation log.
4. Open the control card and review the procedure and RACI.
5. Follow any scorecard entry back to its scenario and evidence.

## First milestone

The implemented exercise covers database network access. The four scenarios are deterministic and use fictional, predefined traffic and log records. Animation represents the selected scenario locally in the browser. The exercise sends no network traffic to the represented addresses. The browser saves completed scenarios locally. Reset clears that round's data.

Conclusive test results determine the match rate. All required tests count toward evidence coverage. After all four scenarios, the example yields 67% conclusive matches and 75% evidence coverage.

## Course expansion

The design can extend with supplier-session expiry, change management, role changes, recovery testing, a risk register, and exercise material mapped to the selected ISO/IEC 27001 or NIST CSF track. This first milestone implements the shared network simulation and one end-to-end control exercise.
