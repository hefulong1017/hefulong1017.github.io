function [Q, R] = givens_rotation(A)
    [m, n] = size(A);
    R = A;
    Q = eye(m);

    for j = 1:min(m-1, n)
        for i = m-1:-1:j
            if R(i+1, j) ~= 0
                r = sqrt(R(i, j)^2 + R(i+1, j)^2);
                c = R(i, j) / r;
                s = -R(i+1, j) / r;

                G = eye(m);
                G([i, i+1], [i, i+1]) = [c, s; -s, c];
                
                R = G' * R;
                Q = Q * G;
            end
        end
    end

    Q = Q';
    R = triu(R);
end

