export default async function handler(req, res) {
    if (req.method !== "GET") return res.status(405).json({ success: false, error: "GET 요청만 허용됩니다." });

    const corpName = String(req.query.corpName || "").trim();
    const address = String(req.query.address || "").trim();
    const host = req.headers.host;
    const protocol = req.headers['x-forwarded-proto'] || 'http';
    const baseUrl = `${protocol}://${host}`;

    if (!corpName) return res.status(400).json({ success: false, error: "상호명을 입력해 주세요." });

    function formatBizNo(val) {
        const num = String(val || "").replace(/\D/g, "");
        return num.length === 10 ? num.replace(/^(\d{3})(\d{2})(\d{5})$/, "$1-$2-$3") : val || "정보없음";
    }
    function formatCorpNo(val) {
        const num = String(val || "").replace(/\D/g, "");
        return num.length === 13 ? num.replace(/^(\d{6})(\d{7})$/, "$1-$2") : val || "정보없음";
    }

    try {
        // [1단계] 비즈노 API 호출
        const bizRes = await fetch(`${baseUrl}/api/bizno?corpName=${encodeURIComponent(corpName)}&address=${encodeURIComponent(address)}`);
        const bizData = await bizRes.json();

        if (!bizData.success || !bizData.items || bizData.items.length === 0) {
            return res.status(200).json({ success: false, error: "해당 상호명으로 등록된 기업정보가 비즈노에 없습니다." });
        }

        // 가장 일치하는 기업 1건 선정
        const target = bizData.items[0];
        const bno = String(target.bno || "").replace(/\D/g, "");

        let resultData = {
            corpName: target.company || corpName,
            ceoNm: "정보없음",
            bizno: formatBizNo(bno),
            crno: formatCorpNo(target.cno),
            phone: "정보없음",
            address: target.address || target.addr || "정보없음",
            status: "국세청 조회 전",
            totalCount: bizData.totalCount,
            returnedCount: bizData.items.length
        };

        // [2단계] 국세청 상태조회 API 호출
        if (bno.length === 10) {
            try {
                const ntsRes = await fetch(`${baseUrl}/api/nts`, {
                    method: "POST",
                    headers: { "Content-Type": "application/json" },
                    body: JSON.stringify({ b_no: bno })
                });
                const ntsData = await ntsRes.json();
                if (ntsData.success) resultData.status = ntsData.status;
            } catch (e) {
                resultData.status = "국세청 조회 실패";
            }
        }

        // [3단계] 금융위원회 API 보완 호출
        try {
            const finRes = await fetch(`${baseUrl}/api/finance?corpName=${encodeURIComponent(corpName)}`);
            const finData = await finRes.json();
            if (finData.success && finData.items.length > 0) {
                const matched = finData.items.find(f => String(f.bzno || "").replace(/\D/g, "") === bno) || finData.items[0];
                if (matched.enpRprFnm) resultData.ceoNm = matched.enpRprFnm;
                if (matched.enpTlno) resultData.phone = matched.enpTlno;
                if (matched.enpBsadr) resultData.address = matched.enpBsadr;
                if (matched.crno) resultData.crno = formatCorpNo(matched.crno);
            }
        } catch (e) {
            console.warn("금융위원회 보완 조회 생략");
        }

        return res.status(200).json({ success: true, ...resultData });

    } catch (error) {
        return res.status(500).json({ success: false, error: "통합 조회 중 오류가 발생했습니다.", detail: error.message });
    }
}
