
export default async function handler(req, res) {
    if (req.method !== "GET") {
        return res.status(405).json({ success: false, error: "GET 요청만 허용됩니다." });
    }

    const corpName = String(req.query.corpName || "").trim();
    const detailUrl = String(req.query.detailUrl || "").trim();

    if (!corpName && !detailUrl) {
        return res.status(400).json({ success: false, error: "상호명이나 상세 URL이 전달되지 않았습니다." });
    }

    const npsApiKey = process.env.DATA_GO_KR_API_KEY || process.env.NPS_API_KEY;

    function formatBizNo(value) {
        const number = String(value || "").replace(/\D/g, "");
        if (number.length !== 10) return value || "정보없음";
        return number.replace(/^(\d{3})(\d{2})(\d{5})$/, "$1-$2-$3");
    }

    if (detailUrl) {
        try {
            const biznoDetail = await fetchAndParseBiznoDetail(detailUrl, corpName);
            const cleanBizno = biznoDetail.bizno.replace(/\D/g, "");

            let finalAddress = biznoDetail.address;
            let addressSource = "비즈노";

            if (npsApiKey && cleanBizno.length >= 6) {
                try {
                    const npsUrl = "https://apis.data.go.kr/B552015/NpsBplcInfoInqireServiceV2/getBassInfoSearchV2";
                    const params = new URLSearchParams({
                        serviceKey: npsApiKey,
                        bzowrRgstNo: cleanBizno.substring(0, 6),
                        wkplNm: corpName,
                        dataType: "json",
                        pageNo: "1",
                        numOfRows: "10"
                    });

                    const npsRes = await fetch(`${npsUrl}?${params.toString()}`);
                    if (npsRes.ok) {
                        const npsData = await npsRes.json();
                        const items = npsData?.response?.body?.items?.item;
                        let npsList = Array.isArray(items) ? items : (items ? [items] : []);

                        const matched = npsList.find(n => {
                            const nBiz = String(n.bzowrRgstNo || "").replace(/\D/g, "");
                            return cleanBizno.startsWith(nBiz.replace(/\*/g, ""));
                        }) || npsList[0];

                        if (matched) {
                            const roadBase = String(matched.wkplRoadNmAddr || "").trim();
                            const roadDetail = String(matched.wkplRoadNmDtlAddr || "").trim();
                            const roadFull = [roadBase, roadDetail]
                                .filter(Boolean)
                                .filter((value, index, arr) => index === 0 || value !== arr[index - 1])
                                .join(" ")
                                .trim();

                            const npsAddress = roadFull ||
                                String(matched.wkplJibunAddr || "").trim();

                            if (npsAddress) {
                                finalAddress = npsAddress;
                                addressSource = "국민연금";
                            }
                        }
                    }
                } catch (e) {
                    console.warn("국민연금 API 조회 실패, 비즈노 주소 유지:", e.message);
                }
            }

            return res.status(200).json({
                success: true,
                mode: "detail",
                corpName: corpName,
                bizno: formatBizNo(cleanBizno),
                ceo: biznoDetail.ceo,
                phone: biznoDetail.phone,
                status: biznoDetail.status,
                address: finalAddress,
                addressSource: addressSource
            });

        } catch (e) {
            return res.status(500).json({ success: false, error: "상세 정보 파싱 실패: " + e.message });
        }
    }

    try {
        const searchUrl = "https://bizno.net/?query=" + encodeURIComponent(corpName);
        const response = await fetch(searchUrl, {
            headers: {
                "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36"
            }
        });
        if (!response.ok) throw new Error("비즈노 검색 페이지 응답 오류: " + response.status);
        const html = await response.text();

        if (html.includes("검색결과가 없습니다") || html.includes("조회된 데이터가 없습니다")) {
            return res.status(200).json({
                success: true,
                mode: "list",
                candidates: [{
                    name: corpName,
                    ceo: "-",
                    status: "-",
                    address: "검색 결과 없음",
                    phone: "-",
                    detailUrl: "",
                    isMultiple: false
                }]
            });
        }

        let items = [];
        const rawSplits = html.split('class="titles"');
        if (rawSplits.length > 1) {
            for (let k = 1; k < rawSplits.length; k++) {
                if (rawSplits[k].includes('href') || rawSplits[k].includes('주소')) {
                    items.push(rawSplits[k]);
                }
            }
        }

        if (items.length === 0) {
            const rawList = html.split('class="list-item"');
            for (let l = 1; l < rawList.length; l++) {
                items.push(rawList[l]);
            }
        }

        let results = [];

        if (items.length === 0) {
            const directParsed = await fetchAndParseBiznoDetail(searchUrl, corpName);
            results.push({
                name: corpName,
                ceo: directParsed.ceo,
                status: directParsed.status,
                address: directParsed.address,
                phone: directParsed.phone,
                detailUrl: searchUrl,
                isMultiple: false
            });
        } else {
            for (let i = 0; i < items.length && i < 10; i++) {
                const itemHtml = items[i];

                const titleMatch = itemHtml.match(/<a[^>]*>([^<]+)<\/a>/);
                let compName = titleMatch ? titleMatch[1].trim() : corpName;

                if (!compName || compName.includes("사업자등록번호") || compName.includes("HOME") || compName.length < 2) {
                    compName = corpName;
                }

                const linkMatch = itemHtml.match(/href="([^"]+)"/);
                let link = linkMatch ? linkMatch[1] : null;
                if (link && !link.startsWith('http')) {
                    link = "https://bizno.net" + link;
                }

                const textOnly = itemHtml.replace(/<\/?[^>]+(>|$)/g, ' ');
                const fullClean = textOnly.replace(/\s+/g, ' ');

                let status = "계속사업자";
                if (fullClean.includes("폐업")) status = "폐업자";
                else if (fullClean.includes("휴업")) status = "휴업자";

                let ceoMasked = "-";
                const lines = textOnly.split('\n').map(s => s.trim()).filter(s => s.length > 0);
                for (let n = 0; n < lines.length; n++) {
                    const l = lines[n];
                    if ((l.includes('*') && l.length >= 2 && l.length <= 6) || /^[가-힣]{2,4}[\*]?$/.test(l)) {
                        if (l !== compName && !l.includes('시') && !l.includes('구') && !l.includes('동') && !l.includes('로') && !l.includes('주식회사')) {
                            ceoMasked = l;
                            break;
                        }
                    }
                }

                let simpleAddr = "소재지 확인 요망";
                const addrMatch = fullClean.match(/((?:서울|부산|대구|인천|광주|대전광역시|대전시|대전\s+[가-힣]+구|울산|세종|경기|강원|충청북|충청남|전라북|전라남|경상북|경상남|제주)[가-힣0-9\-\s\(\)\,\·로길읍면동리]+)/);
                if (addrMatch) {
                    simpleAddr = addrMatch[1].trim();
                }

                results.push({
                    name: compName,
                    ceo: ceoMasked,
                    status: status,
                    address: simpleAddr,
                    phone: "-",
                    detailUrl: link,
                    isMultiple: true
                });
            }
        }

        return res.status(200).json({
            success: true,
            mode: "list",
            candidates: results
        });

    } catch (error) {
        return res.status(500).json({ success: false, error: "검색 중 오류 발생: " + error.message });
    }
}

function decodeHtmlEntities(value) {
    return String(value || "")
        .replace(/&nbsp;|&#160;/gi, " ")
        .replace(/&amp;/gi, "&")
        .replace(/&quot;/gi, '"')
        .replace(/&#39;|&apos;/gi, "'")
        .replace(/&lt;/gi, "<")
        .replace(/&gt;/gi, ">");
}

function extractFullAddress(text) {
    const region = "(?:서울특별시|서울시|서울|부산광역시|부산시|부산|대구광역시|대구시|대구|인천광역시|인천시|인천|광주광역시|광주시|광주|대전광역시|대전시|대전|울산광역시|울산시|울산|세종특별자치시|세종시|세종|경기도|강원특별자치도|강원도|충청북도|충청남도|전북특별자치도|전라북도|전라남도|경상북도|경상남도|제주특별자치도|제주도)";
    const label = "(?:대표자|대표이사|사업자등록번호|법인등록번호|전화번호|전화|연락처|팩스|업태|종목|직원수|개업일자|관할세무서|기업규모|설립일)";
    const re = new RegExp("(" + region + "[\\s가-힣0-9A-Za-z,·ㆍ()（）\\-]+?)(?=\\s+" + label + "|$)", "i");
    const match = String(text || "").match(re);

    if (!match) return "";

    let address = match[1]
        .replace(/\s+/g, " ")
        .replace(/[|｜]+$/g, "")
        .trim();

    address = address.replace(/[;,·]+$/g, "").trim();

    return address.length >= 5 ? address : "";
}

async function fetchAndParseBiznoDetail(url, defaultName) {
    try {
        const parsedUrl = new URL(url);
        if (!["bizno.net", "www.bizno.net"].includes(parsedUrl.hostname)) {
            throw new Error("허용되지 않은 상세 페이지 주소입니다.");
        }

        const response = await fetch(parsedUrl.toString(), {
            headers: { "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36" }
        });
        if (!response.ok) throw new Error("비즈노 페이지 응답 오류: " + response.status);
        const html = await response.text();

        const visibleHtml = html
            .replace(/<script[\s\S]*?<\/script>/gi, " ")
            .replace(/<style[\s\S]*?<\/style>/gi, " ")
            .replace(/<br\s*[\/]?>/gi, "\n")
            .replace(/<\/(?:div|p|li|tr|h[1-6])\s*>/gi, "\n");
        const textOnly = decodeHtmlEntities(
            visibleHtml.replace(/<\/?[^>]+(>|$)/g, " ")
        );
        const lines = textOnly.split("\n").map(l => l.trim()).filter(l => l.length > 0);
        const fullTextClean = textOnly.replace(/\s+/g, " ").trim();

        let ceo = "-";
        let address = "미기재";
        let phone = "번호없음";
        let status = "계속사업자";
        let bizno = "";

        if (fullTextClean.includes("계속사업자")) {
            status = "계속사업자";
        } else if (fullTextClean.includes("폐업자") || (fullTextClean.includes("폐업") && !fullTextClean.includes("계속사업자"))) {
            status = "폐업자";
        } else if (fullTextClean.includes("휴업")) {
            status = "휴업자";
        }

        const biznoMatch = fullTextClean.match(/(\d{3}-\d{2}-\d{5})/);
        if (biznoMatch) {
            bizno = biznoMatch[1];
        }

        const taxOfficeIndex = fullTextClean.indexOf("관할세무서");
        const companyText = taxOfficeIndex >= 0
            ? fullTextClean.slice(0, taxOfficeIndex)
            : fullTextClean;

        const phonePattern = /(?:전화번호|전화|연락처|TEL|전화\s*번호)[\s:：]*(0\d{1,2}-\d{3,4}-\d{4})/gi;
        const labeledPhones = [...companyText.matchAll(phonePattern)];
        const anyPhones = [...companyText.matchAll(/(0\d{1,2}-\d{3,4}-\d{4})/g)];

        if (labeledPhones.length > 0) {
            phone = labeledPhones[0][1];
        } else if (anyPhones.length > 0) {
            phone = anyPhones[0][1];
        } else {
            phone = "번호없음";
        }

        address = extractFullAddress(fullTextClean) || "미기재";

        for (let j = 0; j < lines.length; j++) {
            const l = lines[j];
            if ((l.includes('*') && l.length >= 2 && l.length <= 6) || /^[가-힣]{2,4}[\*]?$/.test(l)) {
                if (l !== defaultName && !l.includes('시') && !l.includes('구') && !l.includes('동') && !l.includes('로') && !l.includes('주식회사')) {
                    ceo = l;
                    break;
                }
            }
        }

        return { bizno, ceo, status, address, phone };
    } catch (e) {
        return { bizno: "", ceo: "-", status: "계속사업자", address: "상세조회 실패", phone: "번호없음" };
    }
}
