access.log in this folder is a web server log (60,000 lines). Write report.json with:
- "top_ips": the 5 client IPs with the most requests, as [ip, count] pairs, most first, ties by IP text order;
- "server_errors_by_path": for status codes 500 and above, the number of such responses per path, as an object with paths in alphabetical order.
Then tell me the busiest IP.
